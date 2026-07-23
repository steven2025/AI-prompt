(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const API_URL = String(window.EVENTS_API_URL || '').trim();
  const state = {
    user: null, events: [], mine: [], notifications: [], pendingMedia: [],
    query: '', kind: '', currentEventId: '', detail: null, mediaTab: 'photo',
    viewerIndex: -1, reply: null, imageCache: new Map()
  };

  function readParentUser() {
    try { return JSON.parse(sessionStorage.getItem('ai-events-parent-user') || 'null'); }
    catch { return null; }
  }
  function identity() {
    if (!state.user) throw new Error('请从主平台登录后进入');
    return { name: state.user.name, phone: state.user.phone, role: state.user.role };
  }
  async function api(payload) {
    if (!API_URL) throw new Error('活动云函数尚未配置');
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...identity(), ...payload })
    });
    const data = await response.json().catch(() => ({ ok: false, message: `服务返回 ${response.status}` }));
    if (!response.ok || !data.ok) throw new Error(data.message || '请求失败');
    return data;
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[ch]);
  }
  function safeUrl(value) {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  }
  function toast(message) {
    $('toast').textContent = message;
    $('toast').classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => $('toast').classList.remove('show'), 2500);
  }
  function kindText(kind) { return kind === 'topic' ? '话题' : '活动'; }
  function statusText(status) {
    return ({ active: '进行中', closed: '已关闭', hidden: '已下架', pending: '待审核', approved: '已发布', rejected: '已退回' })[status] || status;
  }
  function formatTime(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
  }

  async function optimizeImage(file) {
    if (!file || !String(file.type).startsWith('image/')) return file;
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .82));
    if (!blob) return file;
    const name = String(file.name || 'image').replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg' });
  }
  async function filePayload(file, maxMb = 4) {
    if (!file) return null;
    const prepared = await optimizeImage(file);
    if (prepared.size > maxMb * 1024 * 1024) throw new Error(`${prepared.name} 压缩后仍超过${maxMb}MB`);
    const dataBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = reject;
      reader.readAsDataURL(prepared);
    });
    return { name: prepared.name, type: prepared.type, dataBase64 };
  }
  async function filesPayload(files, maxCount = 6) {
    const selected = Array.from(files || []);
    if (selected.length > maxCount) throw new Error(`一次最多上传${maxCount}张照片`);
    const result = [];
    for (const file of selected) result.push(await filePayload(file));
    if (result.reduce((sum, item) => sum + item.dataBase64.length, 0) > 5.5 * 1024 * 1024) {
      throw new Error('本批照片压缩后仍较大，请减少照片数量后分批上传');
    }
    return result;
  }

  async function objectDataUrl(objectKey) {
    if (!objectKey) return '';
    if (state.imageCache.has(objectKey)) return state.imageCache.get(objectKey);
    const data = await api({ action: 'getEventMediaFile', objectKey });
    const url = `data:${data.type || 'image/jpeg'};base64,${data.dataBase64 || ''}`;
    state.imageCache.set(objectKey, url);
    return url;
  }
  async function hydrateImages(root = document) {
    const images = Array.from(root.querySelectorAll('img[data-object-key]:not([data-loaded])'));
    await Promise.all(images.map(async image => {
      image.dataset.loaded = 'loading';
      try { image.src = await objectDataUrl(image.dataset.objectKey); image.dataset.loaded = 'true'; }
      catch { image.alt = '图片加载失败'; image.dataset.loaded = 'error'; }
    }));
  }

  function eventCard(item) {
    const kind = item.kind === 'topic' ? 'topic' : 'activity';
    const tags = (item.tags || []).slice(0, 4).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('');
    const cover = item.cover?.objectKey
      ? `<img data-object-key="${escapeHtml(item.cover.objectKey)}" alt="${escapeHtml(item.title)}封面" />`
      : `<strong>${kindText(kind)}</strong>`;
    const schedule = kind === 'activity' && item.eventTime ? formatTime(item.eventTime) : (item.topicCategory || '持续交流');
    return `<article class="event-card">
      <div class="event-cover ${kind}">${cover}</div>
      <div class="event-body">
        <div class="event-type"><span class="pill ${kind}">${kindText(kind)}</span><span>${escapeHtml(schedule)}</span></div>
        <h2>${escapeHtml(item.title)}</h2>
        <p>${escapeHtml(item.description)}</p>
        <div class="tags">${tags}</div>
        <div class="event-foot"><span>创建者：${escapeHtml(item.creatorName)} · ${item.mediaCount || 0}项媒体 · ${item.commentCount || 0}条评论</span><button class="secondary" data-action="open-event" data-id="${escapeHtml(item.id)}">进入</button></div>
      </div>
    </article>`;
  }
  function filteredEvents(source) {
    const query = state.query.toLowerCase();
    const kind = state.kind || $('kindFilter').value;
    const sort = $('sortFilter').value;
    return source.filter(item => (!kind || item.kind === kind) && (!query || [item.title, item.description, item.creatorName, item.topicCategory, ...(item.tags || [])].join(' ').toLowerCase().includes(query)))
      .sort((a, b) => {
        if (sort === 'created') return String(b.createdAt).localeCompare(String(a.createdAt));
        if (sort === 'eventTime') return String(b.eventTime || '').localeCompare(String(a.eventTime || ''));
        return String(b.updatedAt).localeCompare(String(a.updatedAt));
      });
  }
  function renderSquare() {
    const list = filteredEvents(state.events);
    $('eventList').innerHTML = list.map(eventCard).join('') || '<div class="empty">还没有活动或话题，登录成员可以创建第一个内容集。</div>';
    document.querySelectorAll('.kind-card').forEach(button => button.classList.toggle('active', button.dataset.kind === state.kind));
    hydrateImages($('eventList'));
  }
  function renderMine() {
    $('mineList').innerHTML = state.mine.map(eventCard).join('') || '<div class="empty">你还没有创建活动或话题。</div>';
    hydrateImages($('mineList'));
  }
  function renderNotices() {
    const unread = state.notifications.filter(item => !item.read).length;
    $('noticeBadge').textContent = unread;
    $('noticeBadge').classList.toggle('hidden', !unread);
    $('noticeList').innerHTML = state.notifications.map(item => `<article class="notice ${item.read ? '' : 'unread'}"><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.message)}</p><span class="review-meta">${escapeHtml(item.createdAt)}</span></article>`).join('') || '<div class="empty">暂无通知。</div>';
  }
  function renderAdmin() {
    $('reviewBadge').textContent = state.pendingMedia.length;
    $('reviewBadge').classList.toggle('hidden', !state.pendingMedia.length);
    $('reviewList').innerHTML = state.pendingMedia.map(item => `<article class="review-card">
      <strong>${escapeHtml(item.title)}</strong>
      <div class="review-meta">${escapeHtml(item.eventTitle)} · 提交人：${escapeHtml(item.uploaderName)} · ${escapeHtml(item.linkType === 'direct' ? '对象存储直链' : '外部视频页面')}</div>
      <p>${escapeHtml(item.description || '无说明')}</p>
      <div class="review-actions">
        <button class="secondary" data-action="test-video" data-url="${escapeHtml(item.url)}">测试链接</button>
        <button class="primary" data-action="review-media" data-id="${escapeHtml(item.id)}" data-result="approved">审核通过</button>
        <button class="danger" data-action="review-media" data-id="${escapeHtml(item.id)}" data-result="rejected">退回</button>
      </div>
    </article>`).join('') || '<div class="empty">当前没有待审核视频。</div>';
  }
  function renderDashboard() {
    renderSquare();
    renderMine();
    renderNotices();
    if (state.user?.role === 'admin') renderAdmin();
  }

  async function loadDashboard() {
    if (!state.user) return;
    try {
      const data = await api({ action: 'getEventsDashboard' });
      state.events = Array.isArray(data.events) ? data.events : [];
      state.mine = Array.isArray(data.mine) ? data.mine : [];
      state.notifications = Array.isArray(data.notifications) ? data.notifications : [];
      state.pendingMedia = Array.isArray(data.pendingMedia) ? data.pendingMedia : [];
      renderDashboard();
    } catch (error) {
      toast(error.message);
      renderDashboard();
    }
  }
  function switchView(name) {
    document.querySelectorAll('.view').forEach(view => view.classList.toggle('hidden', view.id !== `view-${name}`));
    document.querySelectorAll('.nav').forEach(button => button.classList.toggle('active', button.dataset.view === name));
    if (name === 'mine') renderMine();
    if (name === 'notices') renderNotices();
    if (name === 'admin') renderAdmin();
  }
  function toggleKindFields() {
    const activity = $('eventKind').value === 'activity';
    document.querySelectorAll('.activity-field').forEach(field => field.classList.toggle('hidden', !activity));
    document.querySelectorAll('.topic-field').forEach(field => field.classList.toggle('hidden', activity));
    $('eventTime').required = activity;
  }

  async function openEvent(eventId) {
    try {
      state.currentEventId = eventId;
      const data = await api({ action: 'getEventDetail', eventId });
      state.detail = data;
      renderEventDetail();
      $('detailOverlay').classList.add('open');
    } catch (error) { toast(error.message); }
  }
  function canManageEvent() {
    return state.user?.role === 'admin' || state.detail?.event?.creatorPhone === state.user?.phone;
  }
  function renderEventDetail() {
    const item = state.detail?.event;
    if (!item) return;
    $('detailTitle').textContent = item.title;
    $('detailMeta').textContent = `${kindText(item.kind)} · 创建者：${item.creatorName} · ${formatTime(item.createdAt)}`;
    const cover = item.cover?.objectKey ? `<img data-object-key="${escapeHtml(item.cover.objectKey)}" alt="${escapeHtml(item.title)}封面" />` : `<strong>${kindText(item.kind)}</strong>`;
    const manage = canManageEvent();
    $('eventIntro').innerHTML = `<div class="intro-cover">${cover}</div><div class="intro-body">
      <span class="pill ${item.kind}">${kindText(item.kind)}</span>
      <h1>${escapeHtml(item.title)}</h1>
      <p>${escapeHtml(item.description)}</p>
      <div class="tags">${(item.tags || []).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>
      <div class="intro-stats"><span>创建者：${escapeHtml(item.creatorName)}</span>${item.eventTime ? `<span>时间：${escapeHtml(formatTime(item.eventTime))}</span>` : ''}${item.location ? `<span>地点：${escapeHtml(item.location)}</span>` : ''}<span>${state.detail.media.length}项媒体</span><span>${state.detail.comments.length}条讨论</span><span>${item.likeCount || 0}人点赞</span></div>
      <div class="creator-tools"><button class="secondary" data-action="like-event">${item.liked ? '取消点赞' : '点赞内容集'}</button>${manage ? `<button class="secondary" data-action="toggle-upload">${item.allowMemberMedia ? '关闭成员上传' : '开放成员上传'}</button><button class="secondary" data-action="toggle-comments">${item.allowComments ? '关闭评论' : '开放评论'}</button>` : ''}</div>
    </div>`;
    $('toggleMediaFormBtn').classList.toggle('hidden', !item.allowMemberMedia && !manage);
    $('eventCommentForm').classList.toggle('hidden', !item.allowComments);
    renderMedia();
    renderEventComments();
    hydrateImages($('eventIntro'));
  }
  function mediaCard(item) {
    const isPhoto = item.mediaType === 'photo';
    const pending = item.status !== 'approved';
    const thumb = (isPhoto ? item.file : item.cover)?.objectKey
      ? `<img data-object-key="${escapeHtml((isPhoto ? item.file : item.cover).objectKey)}" alt="${escapeHtml(item.title)}" />`
      : `<span class="video-mark">${item.linkType === 'external' ? '外部视频页面' : '视频'}</span>`;
    return `<article class="media-card"><div class="media-thumb" data-action="open-media" data-id="${escapeHtml(item.id)}">${thumb}</div><div class="media-card-body"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description || '')}</p><div class="media-card-foot"><span>${escapeHtml(item.uploaderName)} · ${item.likeCount || 0}赞 · ${item.commentCount || 0}评论</span><span>${pending ? `<span class="pill">${statusText(item.status)}</span>` : ''}${item.canHide ? `<button class="text-action" data-action="hide-media" data-id="${escapeHtml(item.id)}">隐藏</button>` : ''}</span></div></div></article>`;
  }
  function renderMedia() {
    const media = state.detail?.media || [];
    $('mediaList').innerHTML = media.map(mediaCard).join('') || '<div class="empty">还没有照片或视频，成员可以共同添加内容。</div>';
    hydrateImages($('mediaList'));
  }
  function commentHtml(comment, replies, allowReply = true) {
    const controls = `<div class="comment-actions"><button class="text-action" data-action="like-comment" data-id="${escapeHtml(comment.id)}">${comment.liked ? '取消点赞' : '点赞'} ${comment.likeCount || 0}</button>${allowReply ? `<button class="text-action" data-action="reply-comment" data-id="${escapeHtml(comment.id)}" data-name="${escapeHtml(comment.authorName)}">回复</button>` : ''}${comment.canHide ? `<button class="text-action" data-action="hide-comment" data-id="${escapeHtml(comment.id)}">隐藏</button>` : ''}</div>`;
    return `<article class="comment"><div class="comment-head"><span>${escapeHtml(comment.authorName)}</span><span>${escapeHtml(comment.createdAt)}</span></div><div class="comment-body">${comment.replyToName ? `回复 ${escapeHtml(comment.replyToName)}：` : ''}${escapeHtml(comment.content)}</div>${controls}</article>${replies.map(reply => `<article class="comment reply"><div class="comment-head"><span>${escapeHtml(reply.authorName)} 回复 ${escapeHtml(reply.replyToName || comment.authorName)}</span><span>${escapeHtml(reply.createdAt)}</span></div><div class="comment-body">${escapeHtml(reply.content)}</div><div class="comment-actions"><button class="text-action" data-action="like-comment" data-id="${escapeHtml(reply.id)}">${reply.liked ? '取消点赞' : '点赞'} ${reply.likeCount || 0}</button>${allowReply ? `<button class="text-action" data-action="reply-comment" data-id="${escapeHtml(comment.id)}" data-name="${escapeHtml(reply.authorName)}">回复</button>` : ''}${reply.canHide ? `<button class="text-action" data-action="hide-comment" data-id="${escapeHtml(reply.id)}">隐藏</button>` : ''}</div></article>`).join('')}`;
  }
  function renderComments(targetType, targetId, container) {
    const comments = (state.detail?.comments || []).filter(item => item.targetType === targetType && item.targetId === targetId);
    const roots = comments.filter(item => !item.parentId);
    container.innerHTML = roots.map(root => commentHtml(root, comments.filter(item => item.parentId === root.id), state.detail.event.allowComments)).join('') || '<div class="empty">还没有评论。</div>';
  }
  function renderEventComments() {
    if (!state.detail?.event) return;
    renderComments('event', state.detail.event.id, $('eventComments'));
  }

  async function openMedia(mediaId) {
    const list = state.detail?.media || [];
    const index = list.findIndex(item => item.id === mediaId);
    if (index < 0) return;
    state.viewerIndex = index;
    state.reply = null;
    await renderViewer();
    $('mediaWindow').classList.remove('hidden');
  }
  async function renderViewer() {
    const media = state.detail.media[state.viewerIndex];
    if (!media) return;
    $('viewerTitle').textContent = media.title;
    $('viewerMeta').textContent = `${media.mediaType === 'photo' ? '照片' : '视频'} · 上传者：${media.uploaderName}`;
    $('mediaInfo').innerHTML = `<h3>${escapeHtml(media.title)}</h3><p>${escapeHtml(media.description || '无说明')}</p>`;
    $('mediaLikeBtn').textContent = media.liked ? '取消点赞' : '点赞';
    $('mediaLikeCount').textContent = `${media.likeCount || 0} 人点赞`;
    $('mediaPosition').textContent = `${state.viewerIndex + 1} / ${state.detail.media.length}`;
    $('mediaPrevBtn').disabled = state.viewerIndex <= 0;
    $('mediaNextBtn').disabled = state.viewerIndex >= state.detail.media.length - 1;
    $('replyBanner').classList.add('hidden');
    $('mediaCommentText').value = '';
    if (media.mediaType === 'photo') {
      $('mediaStage').innerHTML = '<span class="review-meta">正在加载照片...</span>';
      try { $('mediaStage').innerHTML = `<img src="${await objectDataUrl(media.file.objectKey)}" alt="${escapeHtml(media.title)}" />`; }
      catch { $('mediaStage').innerHTML = '<div class="external-video">照片加载失败，请刷新后重试。</div>'; }
    } else if (media.linkType === 'direct') {
      const url = safeUrl(media.url);
      $('mediaStage').innerHTML = url ? `<video src="${escapeHtml(url)}" controls playsinline preload="metadata"></video>` : '<div class="external-video">视频链接无效。</div>';
    } else {
      const url = safeUrl(media.url);
      $('mediaStage').innerHTML = `<div class="external-video"><h2>外部视频页面</h2><p>微信公众号、视频号、网盘及普通网页通常不能嵌入播放，请前往原页面查看。</p>${url ? `<button class="primary" data-action="test-video" data-url="${escapeHtml(url)}">打开原页面</button>` : ''}</div>`;
    }
    renderComments('media', media.id, $('mediaComments'));
  }
  function closeViewer() {
    const video = $('mediaStage').querySelector('video');
    if (video) video.pause();
    $('mediaWindow').classList.add('hidden');
    state.reply = null;
  }
  function moveViewer(direction) {
    const next = state.viewerIndex + direction;
    if (next < 0 || next >= state.detail.media.length) return;
    const video = $('mediaStage').querySelector('video');
    if (video) video.pause();
    state.viewerIndex = next;
    state.reply = null;
    renderViewer();
  }
  function setReply(commentId, name) {
    state.reply = { commentId, name };
    $('replyBanner').textContent = `正在回复 ${name}，点击此处取消`;
    $('replyBanner').classList.remove('hidden');
    $('mediaCommentText').focus();
  }

  async function submitComment(targetType, targetId, content) {
    if (!content.trim()) throw new Error('请输入评论内容');
    await api({
      action: 'addEventComment', eventId: state.currentEventId, targetType, targetId,
      content: content.trim(), parentId: targetType === 'media' ? state.reply?.commentId || '' : '',
      replyToName: targetType === 'media' ? state.reply?.name || '' : ''
    });
    const data = await api({ action: 'getEventDetail', eventId: state.currentEventId });
    state.detail = data;
    renderEventDetail();
    if (targetType === 'media') {
      const currentId = targetId;
      state.viewerIndex = state.detail.media.findIndex(item => item.id === currentId);
      state.reply = null;
      await renderViewer();
    }
    toast('评论提交成功');
  }

  async function handleAction(button) {
    const action = button.dataset.action;
    try {
      if (action === 'open-event') return openEvent(button.dataset.id);
      if (action === 'open-media') return openMedia(button.dataset.id);
      if (action === 'test-video') {
        const url = safeUrl(button.dataset.url);
        if (url) window.open(url, '_blank', 'noopener,noreferrer');
        return;
      }
      if (action === 'review-media') {
        const note = prompt(button.dataset.result === 'approved' ? '审核备注（可留空）：' : '请填写退回原因：') || '';
        if (button.dataset.result === 'rejected' && !note.trim()) return toast('退回时需要填写原因');
        await api({ action: 'reviewEventMedia', mediaId: button.dataset.id, result: button.dataset.result, note });
        toast(button.dataset.result === 'approved' ? '视频已发布' : '视频已退回');
        return loadDashboard();
      }
      if (action === 'like-event') {
        await api({ action: 'toggleEventLike', eventId: state.currentEventId, targetType: 'event', targetId: state.currentEventId });
        return openEvent(state.currentEventId);
      }
      if (action === 'like-comment') {
        await api({ action: 'toggleEventLike', eventId: state.currentEventId, targetType: 'comment', targetId: button.dataset.id });
        const mediaOpen = !$('mediaWindow').classList.contains('hidden');
        const currentMediaId = mediaOpen ? state.detail.media[state.viewerIndex]?.id : '';
        state.detail = await api({ action: 'getEventDetail', eventId: state.currentEventId });
        renderEventDetail();
        if (mediaOpen && currentMediaId) {
          state.viewerIndex = state.detail.media.findIndex(item => item.id === currentMediaId);
          await renderViewer();
        }
        return;
      }
      if (action === 'reply-comment') return setReply(button.dataset.id, button.dataset.name);
      if (action === 'hide-comment') {
        if (!confirm('确定隐藏这条评论吗？')) return;
        await api({ action: 'moderateEventContent', eventId: state.currentEventId, targetType: 'comment', targetId: button.dataset.id, operation: 'hide' });
        state.detail = await api({ action: 'getEventDetail', eventId: state.currentEventId });
        renderEventDetail();
        if (!$('mediaWindow').classList.contains('hidden')) await renderViewer();
        return toast('评论已隐藏');
      }
      if (action === 'hide-media') {
        if (!confirm('确定隐藏这项媒体内容吗？')) return;
        await api({ action: 'moderateEventContent', eventId: state.currentEventId, targetType: 'media', targetId: button.dataset.id, operation: 'hide' });
        toast('媒体内容已隐藏');
        return openEvent(state.currentEventId);
      }
      if (action === 'toggle-upload' || action === 'toggle-comments') {
        const item = state.detail.event;
        await api({ action: 'updateEventSettings', eventId: item.id, allowMemberMedia: action === 'toggle-upload' ? !item.allowMemberMedia : item.allowMemberMedia, allowComments: action === 'toggle-comments' ? !item.allowComments : item.allowComments });
        return openEvent(item.id);
      }
    } catch (error) { toast(error.message); }
  }

  function bindDrag() {
    const box = $('mediaWindow'), handle = $('mediaDragHandle');
    let drag = null;
    handle.addEventListener('pointerdown', event => {
      if (event.target.closest('button') || box.classList.contains('maximized') || innerWidth <= 720) return;
      const rect = box.getBoundingClientRect();
      drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', event => {
      if (!drag) return;
      const maxLeft = Math.max(0, innerWidth - box.offsetWidth);
      const maxTop = Math.max(0, innerHeight - 80);
      box.style.left = `${Math.min(maxLeft, Math.max(0, drag.left + event.clientX - drag.x))}px`;
      box.style.top = `${Math.min(maxTop, Math.max(0, drag.top + event.clientY - drag.y))}px`;
    });
    handle.addEventListener('pointerup', () => { drag = null; });
  }
  function bind() {
    document.querySelectorAll('.nav').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
    $('eventKind').addEventListener('change', toggleKindFields);
    $('eventCover').addEventListener('change', () => $('coverName').textContent = $('eventCover').files?.[0]?.name || '可选，建议横向图片，文件不超过4MB。');
    $('searchBtn').addEventListener('click', () => { state.query = $('searchInput').value.trim(); renderSquare(); });
    $('searchInput').addEventListener('keydown', event => { if (event.key === 'Enter') $('searchBtn').click(); });
    $('kindFilter').addEventListener('change', () => { state.kind = $('kindFilter').value; renderSquare(); });
    $('sortFilter').addEventListener('change', renderSquare);
    document.querySelectorAll('.kind-card').forEach(button => button.addEventListener('click', () => { state.kind = button.dataset.kind; $('kindFilter').value = state.kind; renderSquare(); }));
    $('refreshMineBtn').addEventListener('click', loadDashboard);
    $('refreshAdminBtn').addEventListener('click', loadDashboard);
    $('detailRefreshBtn').addEventListener('click', () => openEvent(state.currentEventId));
    $('detailCloseBtn').addEventListener('click', () => { closeViewer(); $('detailOverlay').classList.remove('open'); loadDashboard(); });
    $('toggleMediaFormBtn').addEventListener('click', () => $('mediaSubmit').classList.toggle('hidden'));
    document.querySelectorAll('[data-media-tab]').forEach(button => button.addEventListener('click', () => {
      state.mediaTab = button.dataset.mediaTab;
      document.querySelectorAll('[data-media-tab]').forEach(item => item.classList.toggle('active', item === button));
      $('photoForm').classList.toggle('hidden', state.mediaTab !== 'photo');
      $('videoForm').classList.toggle('hidden', state.mediaTab !== 'video');
    }));
    $('replyBanner').addEventListener('click', () => { state.reply = null; $('replyBanner').classList.add('hidden'); });
    $('viewerCloseBtn').addEventListener('click', closeViewer);
    $('viewerMaxBtn').addEventListener('click', () => $('mediaWindow').classList.toggle('maximized'));
    $('viewerFullscreenBtn').addEventListener('click', () => {
      const target = $('mediaWindow');
      if (target.requestFullscreen) target.requestFullscreen();
      else toast('当前浏览器不支持全屏');
    });
    $('mediaPrevBtn').addEventListener('click', () => moveViewer(-1));
    $('mediaNextBtn').addEventListener('click', () => moveViewer(1));
    $('mediaLikeBtn').addEventListener('click', async () => {
      try {
        const media = state.detail.media[state.viewerIndex];
        await api({ action: 'toggleEventLike', eventId: state.currentEventId, targetType: 'media', targetId: media.id });
        state.detail = await api({ action: 'getEventDetail', eventId: state.currentEventId });
        state.viewerIndex = state.detail.media.findIndex(item => item.id === media.id);
        renderEventDetail();
        await renderViewer();
      } catch (error) { toast(error.message); }
    });
    document.addEventListener('click', event => { const button = event.target.closest('[data-action]'); if (button) handleAction(button); });
    $('markReadBtn').addEventListener('click', async () => {
      try { await api({ action: 'markEventNotificationsRead', ids: state.notifications.map(item => item.id) }); toast('通知已标记为已读'); await loadDashboard(); }
      catch (error) { toast(error.message); }
    });
    $('eventForm').addEventListener('submit', async event => {
      event.preventDefault();
      const button = $('createEventBtn');
      button.disabled = true; button.textContent = '正在创建...';
      try {
        const cover = await filePayload($('eventCover').files?.[0]);
        const data = await api({ action: 'createEvent', event: {
          kind: $('eventKind').value, title: $('eventTitle').value.trim(), eventTime: $('eventTime').value,
          location: $('eventLocation').value.trim(), topicCategory: $('topicCategory').value,
          description: $('eventDescription').value.trim(),
          tags: $('eventTags').value.split(/[,，]/).map(item => item.trim()).filter(Boolean),
          allowMemberMedia: $('allowMemberMedia').checked, allowComments: $('allowComments').checked
        }, cover });
        event.target.reset(); toggleKindFields();
        $('createState').textContent = '创建成功，正在进入内容集。';
        $('createState').className = 'submit-state ok';
        await loadDashboard();
        switchView('square');
        await openEvent(data.event.id);
      } catch (error) {
        $('createState').textContent = `创建失败：${error.message}`;
        $('createState').className = 'submit-state error';
      } finally { button.disabled = false; button.textContent = '创建并进入内容集'; }
    });
    $('photoForm').addEventListener('submit', async event => {
      event.preventDefault();
      const button = $('submitPhotoBtn');
      button.disabled = true; button.textContent = '正在上传...';
      try {
        const files = await filesPayload($('photoFiles').files);
        await api({ action: 'addEventPhotos', eventId: state.currentEventId, title: $('photoTitle').value.trim(), description: $('photoDescription').value.trim(), files });
        event.target.reset();
        $('mediaState').textContent = '照片上传成功，已进入当前内容集。';
        $('mediaState').className = 'submit-state ok';
        toast('照片上传成功');
        await openEvent(state.currentEventId);
      } catch (error) {
        $('mediaState').textContent = `上传失败：${error.message}`;
        $('mediaState').className = 'submit-state error';
      } finally { button.disabled = false; button.textContent = '上传照片'; }
    });
    $('videoForm').addEventListener('submit', async event => {
      event.preventDefault();
      const button = $('submitVideoBtn');
      button.disabled = true; button.textContent = '正在提交...';
      try {
        const cover = await filePayload($('videoCover').files?.[0]);
        await api({ action: 'addEventVideoLink', eventId: state.currentEventId, video: {
          linkType: $('videoLinkType').value, title: $('videoTitle').value.trim(),
          url: $('videoUrl').value.trim(), platform: $('videoPlatform').value.trim(),
          description: $('videoDescription').value.trim()
        }, cover });
        event.target.reset();
        $('mediaState').textContent = '视频链接提交成功，管理员审核后公开。';
        $('mediaState').className = 'submit-state ok';
        toast('视频已进入审核队列');
        await openEvent(state.currentEventId);
      } catch (error) {
        $('mediaState').textContent = `提交失败：${error.message}`;
        $('mediaState').className = 'submit-state error';
      } finally { button.disabled = false; button.textContent = '提交管理员审核'; }
    });
    $('eventCommentForm').addEventListener('submit', async event => {
      event.preventDefault();
      try { await submitComment('event', state.currentEventId, $('eventCommentText').value); $('eventCommentText').value = ''; }
      catch (error) { toast(error.message); }
    });
    $('mediaCommentForm').addEventListener('submit', async event => {
      event.preventDefault();
      try {
        const media = state.detail.media[state.viewerIndex];
        await submitComment('media', media.id, $('mediaCommentText').value);
      } catch (error) { toast(error.message); }
    });
    window.addEventListener('message', event => {
      if (event.origin === location.origin && event.data?.type === 'DS_PLATFORM_USER') {
        state.user = event.data.user;
        initUser();
      }
    });
    bindDrag();
  }
  function initUser() {
    if (!state.user) { $('userText').textContent = '请从主平台登录后进入'; return; }
    $('userText').textContent = `当前用户：${state.user.name}${state.user.role === 'admin' ? ' · 管理员' : ''}`;
    document.querySelectorAll('.admin-only').forEach(element => element.classList.toggle('hidden', state.user.role !== 'admin'));
    loadDashboard();
  }

  $('serviceAlert').classList.toggle('hidden', Boolean(API_URL));
  bind();
  toggleKindFields();
  state.user = readParentUser();
  renderDashboard();
  initUser();
})();
