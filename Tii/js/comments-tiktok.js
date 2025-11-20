/* TikTok-style comments UI module
   - Replaces existing comments list inside `.comments-section` elements
   - Uses existing API endpoints: GET /api/courses/:course/lessons/:lesson/comments
   - POST to create, DELETE to remove (supports anonymous deletion token via x-deletion-token)
   - Subscribes to SSE /api/comments/stream?courseId=... to refresh on events
*/
(function(){
  'use strict';
  const COURSE_ID = (window.COURSE_ID || window.location.pathname.split('/').pop().replace('.html','')) || null;
  if (!COURSE_ID) return; // nothing to do

  // Helpers
  const apiBase = '';
  function el(tag, props, ...children){ const e = document.createElement(tag); if(props) Object.keys(props).forEach(k=>{ if(k==='class') e.className=props[k]; else if(k==='html') e.innerHTML=props[k]; else e.setAttribute(k,props[k]); }); children.forEach(c=>{ if(c===null || c===undefined) return; e.appendChild(typeof c==='string'?document.createTextNode(c):c); }); return e; }
  function fmtTime(ts){ try{ if(!ts) return ''; const d = new Date(ts); const ago = Date.now()-d.getTime(); if(ago<60000) return Math.floor(ago/1000)+'s'; if(ago<3600000) return Math.floor(ago/60000)+'m'; if(ago<86400000) return Math.floor(ago/3600000)+'h'; return d.toLocaleDateString(); }catch(e){return ''} }
  function initials(name){ if(!name) return '?'; return name.split(/\s+/).map(s=>s[0]||'').slice(0,2).join('').toUpperCase(); }

  // Render a single comments-section into a TikTok-style UI
  async function enhanceSection(sec){
    const lessonId = sec.dataset.lessonId;
    if(!lessonId) return;
    sec.classList.add('tt-comments-root');
    // create UI shell
    const listWrap = el('div',{class:'tt-comments-list'});
    const inputBar = el('div',{class:'tt-input-bar'});
    const textarea = el('textarea',{class:'tt-input', placeholder:'Add a comment...'});
    textarea.style.resize='vertical'; textarea.style.minHeight='44px';
    const postBtn = el('button',{class:'tt-post'}, 'Post');
    inputBar.appendChild(textarea); inputBar.appendChild(postBtn);

    // replace existing list area if present
    const existingList = sec.querySelector('.comments-list');
    if (existingList) existingList.replaceWith(listWrap);
    else sec.appendChild(listWrap);
    // move form to inputBar (hide old form)
    const oldForm = sec.querySelector('.comment-form'); if(oldForm) oldForm.style.display='none';
    sec.appendChild(inputBar);

    // load and render
    async function loadComments(){
      listWrap.innerHTML = '';
      listWrap.appendChild(el('div',{class:'tt-empty'}, 'Loading comments...'));
      try{
        const res = await fetch(`${apiBase}/api/courses/${encodeURIComponent(COURSE_ID)}/lessons/${encodeURIComponent(lessonId)}/comments`);
        if(!res.ok) { listWrap.innerHTML = ''; listWrap.appendChild(el('div',{class:'tt-empty'}, 'Failed to load comments')); return; }
        const jb = await res.json(); const comments = jb.comments || [];
        if(!comments.length){ listWrap.innerHTML=''; listWrap.appendChild(el('div',{class:'tt-empty'}, 'No comments yet — be the first.')); return; }
        listWrap.innerHTML='';
        comments.forEach(c=>{ listWrap.appendChild(renderComment(c, lessonId)); });
      }catch(e){ console.error('loadComments',e); listWrap.innerHTML=''; listWrap.appendChild(el('div',{class:'tt-empty'}, 'Error loading comments')); }
    }

    function renderComment(c, lessonId){
      const box = el('div',{class:'tt-comment'});
      // ensure relative positioning for absolute menu
      box.style.position = 'relative';
      if(c && c.id) box.dataset.commentId = c.id;
      const av = el('div',{class:'tt-avatar'}, initials(c.author));
      const body = el('div',{class:'tt-body'});
      const meta = el('div',{class:'tt-meta'});
      meta.appendChild(el('span',{class:'tt-author'}, c.author));
      if(c.role) meta.appendChild(el('span',{class:'tt-role'}, ' • '+c.role));
      meta.appendChild(el('span',{class:'tt-time'}, fmtTime(c.created_ts||c.created_at)));
      body.appendChild(meta);
      body.appendChild(el('div',{class:'tt-text'}, c.text));

      // actions: like, reply, (menu for delete)
      const actions = el('div',{class:'tt-actions'});
      const likeBtn = el('button',{class:'tt-btn tt-like'}, `♥ ${getLikeCount(c.id)}`);
      likeBtn.addEventListener('click', ()=>{ toggleLike(c.id); likeBtn.textContent = `♥ ${getLikeCount(c.id)}`; });
      actions.appendChild(likeBtn);

      const replyBtn = el('button',{class:'tt-btn'}, 'Reply');
      actions.appendChild(replyBtn);

        // Three-dot menu: Report (all users) and Edit/Delete (owner or admin)
        const canEdit = canCurrentUserEdit(c);
        const menuBtn = el('button',{class:'tt-btn tt-menu'}, '⋯');
        menuBtn.style.padding = '6px 10px'; menuBtn.style.fontSize = '18px'; menuBtn.style.lineHeight='1';
        const menuPopup = el('div',{class:'tt-menu-popup', style:'display:none;position:absolute;right:8px;top:36px;background:#fff;border:1px solid #ddd;border-radius:6px;padding:6px;box-shadow:0 6px 20px rgba(0,0,0,0.12);z-index:1000'});

        // Report (available to anyone)
        const reportBtn = el('button',{class:'tt-btn tt-report-small'}, 'Report');
        reportBtn.addEventListener('click', async ()=>{
          try{
            const reason = prompt('Reason for reporting this comment (optional):');
            if(reason === null) return;
            const r = await fetch(`${apiBase}/api/courses/${encodeURIComponent(COURSE_ID)}/lessons/${encodeURIComponent(lessonId)}/comments/${encodeURIComponent(c.id)}/report`, {
              method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ reason })
            });
            if (r.ok) { alert('Comment reported. Thank you.'); menuPopup.style.display='none'; }
            else { alert('Report failed (server may not support reporting).'); }
          }catch(e){ console.warn('report error',e); alert('Report failed'); }
        });
        menuPopup.appendChild(reportBtn);

        if(canEdit){
          const editBtn = el('button',{class:'tt-btn tt-edit-small'}, 'Edit');
          editBtn.addEventListener('click', (ev)=>{
            ev.stopPropagation();
            const textEl = box.querySelector('.tt-text');
            if(!textEl) return;
            const orig = textEl.textContent || '';
            textEl.style.display = 'none';
            const editForm = el('div',{class:'tt-edit-form'});
            const ta = el('textarea',{});
            ta.value = orig; ta.style.minHeight='60px';
            const actionsWrap = el('div',{class:'tt-edit-actions'});
            const save = el('button',{class:'save'}, 'Save');
            const cancel = el('button',{class:'cancel'}, 'Cancel');
            actionsWrap.appendChild(save); actionsWrap.appendChild(cancel);
            editForm.appendChild(ta); editForm.appendChild(actionsWrap);
            textEl.parentNode.insertBefore(editForm, textEl.nextSibling);

            cancel.addEventListener('click', ()=>{ try{ editForm.remove(); textEl.style.display='block'; }catch(e){} });
            save.addEventListener('click', async ()=>{
              const newText = ta.value.trim(); if(!newText){ alert('Comment cannot be empty'); return; }
              try{
                const headers = {'Content-Type':'application/json'}; const token = localStorage.getItem('token') || localStorage.getItem('authToken'); if(token) headers['Authorization']='Bearer '+token;
                const r = await fetch(`${apiBase}/api/courses/${encodeURIComponent(COURSE_ID)}/lessons/${encodeURIComponent(lessonId)}/comments/${encodeURIComponent(c.id)}`, { method: 'PUT', headers, body: JSON.stringify({ text: newText }) });
                if (r.ok) { loadComments(); }
                else {
                  const jb = await r.json().catch(()=>null);
                  alert(jb && jb.message ? jb.message : 'Edit failed (server may not support edit).');
                }
              }catch(e){ console.error('edit error',e); alert('Edit failed'); }
            });
            menuPopup.style.display='none';
          });
          menuPopup.appendChild(editBtn);

          const del = el('button',{class:'tt-btn tt-delete-small'}, 'Delete');
          del.addEventListener('click', async ()=>{ if(!confirm('Delete comment?')) return; await deleteComment(lessonId,c.id); loadComments(); });
          menuPopup.appendChild(del);
        }

        menuBtn.addEventListener('click', (ev)=>{ ev.stopPropagation(); menuPopup.style.display = menuPopup.style.display==='none'?'block':'none'; });
        document.addEventListener('click', ()=>{ try{ menuPopup.style.display='none'; }catch(e){} });
        actions.appendChild(menuBtn); actions.appendChild(menuPopup);

      body.appendChild(actions);

      // replies
      if(c.replies && c.replies.length){ const repWrap = el('div',{class:'tt-replies'}); c.replies.forEach(r=>repWrap.appendChild(renderReply(r, lessonId, c))); body.appendChild(repWrap); }

      // reply form (hidden)
      const replyForm = el('form',{class:'tt-reply-form', style:'display:none;margin-top:8px'});
      const rta = el('textarea',{class:'tt-input', placeholder:'Reply...'}); rta.style.minHeight='40px';
      const rpost = el('button',{class:'tt-post'}, 'Reply');
      replyForm.appendChild(rta); replyForm.appendChild(rpost);
      replyForm.addEventListener('submit', async (ev)=>{ ev.preventDefault(); const t = rta.value.trim(); if(!t) return; await postComment(lessonId,t,c.id); rta.value=''; replyForm.style.display='none'; loadComments(); });
      replyBtn.addEventListener('click', ()=>{ replyForm.style.display = replyForm.style.display==='none'?'block':'none'; });
      body.appendChild(replyForm);

      box.appendChild(av); box.appendChild(body);
      return box;
    }

    function renderReply(r, lessonId, parent){
      const box = el('div',{class:'tt-reply'});
      box.style.position = 'relative';
      // show chain like: replier > target
      const target = r.reply_to_name || parent && parent.author || '';
      const chain = target ? `${r.author} > ${target}` : r.author;
      box.appendChild(el('div',{class:'tt-meta'}, el('strong',null,chain), ' ', el('span',{class:'tt-time'}, fmtTime(r.created_ts||r.created_at))));
      box.appendChild(el('div',{class:'tt-text'}, r.text));

      // allow replying to a reply (nested reply)
      const replyActions = el('div',{class:'tt-reply-actions'});
      const replyBtn = el('button',{class:'tt-btn tt-reply-small'}, 'Reply');
      replyActions.appendChild(replyBtn);

      // three-dot menu for reply: Report (all), Edit/Delete (owner or admin)
      const canEditReply = canCurrentUserEdit(r);
      const rmenuBtn = el('button',{class:'tt-btn tt-menu'}, '⋯'); rmenuBtn.style.padding='4px 8px'; rmenuBtn.style.fontSize='16px';
      const rmenuPopup = el('div',{class:'tt-menu-popup', style:'display:none;position:absolute;right:8px;top:8px;background:#fff;border:1px solid #ddd;border-radius:6px;padding:6px;box-shadow:0 6px 20px rgba(0,0,0,0.12);z-index:1000'});
      const rreport = el('button',{class:'tt-btn tt-report-small'}, 'Report');
      rreport.addEventListener('click', async ()=>{ const reason = prompt('Reason for reporting this reply (optional):'); if(reason===null) return; try{ const rr = await fetch(`${apiBase}/api/courses/${encodeURIComponent(COURSE_ID)}/lessons/${encodeURIComponent(lessonId)}/comments/${encodeURIComponent(r.id)}/report`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ reason }) }); if(rr.ok) alert('Reply reported'); else alert('Report failed'); }catch(e){alert('Report failed');} });
      rmenuPopup.appendChild(rreport);
      if(canEditReply){
        const redit = el('button',{class:'tt-btn tt-edit-small'}, 'Edit');
        redit.addEventListener('click', (ev)=>{
          ev.stopPropagation(); const textEl = box.querySelector('.tt-text'); if(!textEl) return; const orig = textEl.textContent||''; textEl.style.display='none'; const editForm = el('div',{class:'tt-edit-form'}); const ta = el('textarea',{}); ta.value = orig; const actionsWrap = el('div',{class:'tt-edit-actions'}); const save = el('button',{class:'save'}, 'Save'); const cancel = el('button',{class:'cancel'}, 'Cancel'); actionsWrap.appendChild(save); actionsWrap.appendChild(cancel); editForm.appendChild(ta); editForm.appendChild(actionsWrap); textEl.parentNode.insertBefore(editForm, textEl.nextSibling);
          cancel.addEventListener('click', ()=>{ try{ editForm.remove(); textEl.style.display='block'; }catch(e){} });
          save.addEventListener('click', async ()=>{ const newText = ta.value.trim(); if(!newText){ alert('Reply cannot be empty'); return; } try{ const headers={'Content-Type':'application/json'}; const token = localStorage.getItem('token') || localStorage.getItem('authToken'); if(token) headers['Authorization']='Bearer '+token; const rres = await fetch(`${apiBase}/api/courses/${encodeURIComponent(COURSE_ID)}/lessons/${encodeURIComponent(lessonId)}/comments/${encodeURIComponent(r.id)}`, { method:'PUT', headers, body: JSON.stringify({ text: newText }) }); if(rres.ok) loadComments(); else { const jb = await rres.json().catch(()=>null); alert(jb && jb.message ? jb.message : 'Edit failed'); } }catch(e){ alert('Edit failed'); } });
        });
        rmenuPopup.appendChild(redit);
        const rdel = el('button',{class:'tt-btn tt-delete-small'}, 'Delete'); rdel.addEventListener('click', async ()=>{ if(!confirm('Delete reply?')) return; await deleteComment(lessonId,r.id); loadComments(); }); rmenuPopup.appendChild(rdel);
      }
      rmenuBtn.addEventListener('click',(ev)=>{ ev.stopPropagation(); rmenuPopup.style.display = rmenuPopup.style.display==='none'?'block':'none'; });
      document.addEventListener('click', ()=>{ try{ rmenuPopup.style.display='none'; }catch(e){} });
      replyActions.appendChild(rmenuBtn); replyActions.appendChild(rmenuPopup);
      // small inline reply form
      const inlineForm = el('form',{class:'tt-reply-inline', style:'display:none;margin-top:8px'});
      const inlineTa = el('textarea',{class:'tt-input', placeholder:'Reply...'});
      inlineTa.style.minHeight='38px';
      const inlinePost = el('button',{class:'tt-post'}, 'Reply');
      inlineForm.appendChild(inlineTa); inlineForm.appendChild(inlinePost);
      inlineForm.addEventListener('submit', async (ev)=>{ ev.preventDefault(); const t = inlineTa.value.trim(); if(!t) return; // when replying to a reply we keep parentId as parent.id (top-level)
        await postComment(lessonId, t, parent.id, { reply_to_id: r.id, reply_to_name: r.author }); inlineTa.value=''; inlineForm.style.display='none'; await loadComments(); });
      replyBtn.addEventListener('click', ()=>{ inlineForm.style.display = inlineForm.style.display==='none' ? 'block' : 'none'; });
      box.appendChild(replyActions); box.appendChild(inlineForm);
      return box;
    }

    // Likes stored locally
    function getLikeKey(){ return `c_likes_${COURSE_ID}`; }
    function getLikes(){ try{ return JSON.parse(localStorage.getItem(getLikeKey())||'{}'); }catch(e){return{}} }
    function getLikeCount(id){ const likes = getLikes(); return likes[id]||0; }
    function toggleLike(id){ const likes = getLikes(); likes[id] = likes[id] ? 0 : 1; localStorage.setItem(getLikeKey(), JSON.stringify(likes)); }

    function canCurrentUserDelete(c){
      try{
        // If logged in, compare several identifying fields to the comment author
        const token = localStorage.getItem('token') || localStorage.getItem('authToken');
        if(token){
          const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
          if(payload){
            // admins can delete any comment
            if(payload.role && String(payload.role).toLowerCase()==='admin') return true;
            // check email, name, preferred_username, sub/uid against comment fields
            const possibles = [payload.email, payload.name, payload.preferred_username, payload.preferred_username, payload.sub, payload.uid].filter(Boolean).map(String);
            const authorVals = [c.author, c.author_email, c.author_id].filter(Boolean).map(String);
            for(const a of possibles){ for(const b of authorVals){ if(a === b) return true; } }
          }
        }
        // anonymous deletion token saved on post
        const anon = localStorage.getItem('c_del_'+c.id);
        if(anon) return true;
        return false;
      }catch(e){ return false; }
    }

    // Helper: whether current user may edit this comment (owner or admin)
    function canCurrentUserEdit(c){
      try{ return canCurrentUserDelete(c); }catch(e){ return false; }
    }

    async function postComment(lessonId, text, parentId, opts){
      try{
        const headers = {'Content-Type':'application/json'};
        const token = localStorage.getItem('token') || localStorage.getItem('authToken');
        if(token) headers['Authorization'] = 'Bearer '+token;
        const body = { text };
        if(parentId) body.parentId = parentId;
        if(opts && opts.reply_to_id) body.reply_to_id = opts.reply_to_id;
        if(opts && opts.reply_to_name) body.reply_to_name = opts.reply_to_name;
        const r = await fetch(`${apiBase}/api/courses/${encodeURIComponent(COURSE_ID)}/lessons/${encodeURIComponent(lessonId)}/comments`, { method:'POST', headers, body: JSON.stringify(body) });
        const jb = await r.json().catch(()=>null);
        if(r.ok && jb && jb.deletion_token && jb.id) localStorage.setItem('c_del_'+jb.id, jb.deletion_token);
        return jb;
      } catch(e){ console.error('postComment',e); }
    }

    async function deleteComment(lessonId, commentId){ try{ const headers = {}; const token = localStorage.getItem('token') || localStorage.getItem('authToken'); if(token) headers['Authorization'] = 'Bearer '+token; else { const tok = localStorage.getItem('c_del_'+commentId); if(tok) headers['x-deletion-token'] = tok; } const r = await fetch(`${apiBase}/api/courses/${encodeURIComponent(COURSE_ID)}/lessons/${encodeURIComponent(lessonId)}/comments/${encodeURIComponent(commentId)}`, { method:'DELETE', headers }); if(r.ok) { localStorage.removeItem('c_del_'+commentId); return true; } const jb = await r.json().catch(()=>null); console.warn('delete failed', jb); return false; }catch(e){console.error('deleteComment',e);return false} }

    // bind post button
    postBtn.addEventListener('click', async ()=>{
      const t = textarea.value.trim(); if(!t) return; postBtn.disabled = true;
      const jb = await postComment(lessonId,t);
      textarea.value='';
      // if server returned id, reload and highlight new comment
      await loadComments();
      try{
        if(jb && jb.id){
          const elNew = listWrap.querySelector(`[data-comment-id="${jb.id}"]`);
          if(elNew){ elNew.classList.add('tt-new'); setTimeout(()=>elNew.classList.remove('tt-new'), 900); elNew.scrollIntoView({behavior:'smooth',block:'center'}); }
        }
      }catch(e){}
      postBtn.disabled = false;
    });

    // SSE: subscribe to course-level stream and refresh on matching lessonId
    try{
      const token = localStorage.getItem('token') || localStorage.getItem('authToken');
      const url = `/api/comments/stream?courseId=${encodeURIComponent(COURSE_ID)}` + (token? `&token=${encodeURIComponent(token)}`:'');
      const es = new EventSource(url);
      es.onmessage = function(ev){ try{ const p = JSON.parse(ev.data||'{}'); if(!p || p.type!=='comment') return; if(p.lessonId && p.lessonId===lessonId) loadComments(); if(!p.lessonId) loadComments(); }catch(e){} };
      es.onerror = ()=>{ try{ es.close(); }catch(e){} };
    }catch(e){ /* ignore */ }

    // initial load
    await loadComments();
  }

  // find all comment sections and enhance them
  document.addEventListener('DOMContentLoaded', ()=>{ document.querySelectorAll('.comments-section').forEach(s=>{ try{ enhanceSection(s); }catch(e){console.error('enhanceSection',e)} }); });

})();
