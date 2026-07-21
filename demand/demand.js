(() => {
  'use strict';

  const API_URL = String(window.DEMAND_CONFIG?.apiUrl || '').trim();
  const $ = id => document.getElementById(id);
  const state = { user: null, profile: null, demands: [], applications: [], notifications: [], profiles: [], view: 'market' };
  let toastTimer = null;

  const statusNames = {
    pending_review: '待管理员审核', recruiting: '招募成员', assigned: '团队已确定',
    development: '开发中', testing: '需求方试用', completed: '完成本轮实践',
    rejected: '审核未通过', withdrawn: '已撤回', closed: '已关闭'
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function readParentUser() {
    const keys = ['ai-demand-parent-user', 'ds_platform_current_user'];
    for (const key of keys) {
      try {
        const value = JSON.parse(sessionStorage.getItem(key) || 'null');
        const user = value?.user || value;
        if (user?.name && user?.phone) return user;
      } catch (err) {}
    }
    return null;
  }

  async function api(payload) {
    if (!API_URL) throw new Error('需求云函数尚未配置');
    if (!state.user) throw new Error('请从主平台登录后进入');
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, name: state.user.name, phone: state.user.phone })
    });
    const data = await response.json().catch(() => ({ ok: false, message: '云函数未返回JSON' }));
    if (!response.ok || data.ok === false) throw new Error(data.message || '请求失败');
    return data;
  }

  function profileComplete() {
    return Boolean(state.profile?.identityType && state.profile?.organization);
  }

  function isAdmin() { return state.user?.role === 'admin'; }
  function isTeamMember() { return state.profile?.teamStatus === 'approved'; }

  async function loadDashboard() {
    if (!state.user) return;
    if (!API_URL) {
      $('serviceAlert').classList.remove('hidden');
      renderAll();
      return;
    }
    try {
      const data = await api({ action: 'getDemandDashboard' });
      state.profile = data.profile || null;
      state.demands = Array.isArray(data.demands) ? data.demands : [];
      state.applications = Array.isArray(data.applications) ? data.applications : [];
      state.notifications = Array.isArray(data.notifications) ? data.notifications : [];
      state.profiles = Array.isArray(data.profiles) ? data.profiles : [];
      $('serviceAlert').classList.add('hidden');
      renderAll();
    } catch (err) {
      $('serviceAlert').classList.remove('hidden');
      $('serviceAlert').textContent = `需求云端服务连接失败：${err.message}`;
      renderAll();
    }
  }

  function switchView(view) {
    state.view = view;
    document.querySelectorAll('.view').forEach(el => el.classList.add('hidden'));
    $(`view-${view}`)?.classList.remove('hidden');
    document.querySelectorAll('.nav').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
    if (view === 'publish' && !profileComplete()) {
      toast('发布需求前请先完善个人资料');
      openProfile();
    }
  }

  function unitText(demand) {
    if (demand.visibility === 'anonymous') return '匿名需求方';
    if (demand.visibility === 'public') return demand.ownerOrganization || demand.ownerType || '需求方';
    return demand.ownerType || '需求方';
  }

  function filesHtml(files) {
    if (!Array.isArray(files) || !files.length) return '';
    return `<div class="actions">${files.map(file => `<button class="secondary" data-action="download" data-key="${escapeHtml(file.objectKey)}" data-name="${escapeHtml(file.name)}">下载 ${escapeHtml(file.name)}</button>`).join('')}</div>`;
  }

  function applicationsHtml(demand) {
    const list = state.applications.filter(item => item.demandId === demand.id);
    const canDecide = isAdmin() || demand.ownerPhone === state.user?.phone;
    if (!canDecide || !list.length) return '';
    return `<div class="detail"><b>参与申请（${list.length}）</b>${list.map(app => `<div class="summary"><strong>${escapeHtml(app.applicantName)}</strong> · ${escapeHtml(app.roleWanted)} · ${escapeHtml(app.status === 'accepted' ? '已确定' : app.status === 'rejected' ? '未选中' : '待选择')}<br>${escapeHtml(app.message)}${app.status === 'pending' ? `<div class="actions"><button class="success" data-action="accept-application" data-id="${escapeHtml(app.id)}">确定参与</button><button class="danger" data-action="reject-application" data-id="${escapeHtml(app.id)}">不选中</button></div>` : ''}</div>`).join('')}</div>`;
  }

  function demandCard(demand, context = 'market') {
    const own = demand.ownerPhone === state.user?.phone;
    const myApplication = state.applications.find(item => item.demandId === demand.id && item.applicantPhone === state.user?.phone);
    const canApply = demand.status === 'recruiting' && isTeamMember() && !own && !myApplication;
    const canProgress = isAdmin() || own || demand.teamLeaderPhone === state.user?.phone;
    const contact = demand.contact ? `<div class="contact"><b>项目联系信息</b><br>${escapeHtml(demand.contact.name)} · ${escapeHtml(demand.contact.phone)}${demand.contact.wechat ? ` · 微信：${escapeHtml(demand.contact.wechat)}` : ''}${demand.contact.email ? ` · 邮箱：${escapeHtml(demand.contact.email)}` : ''}</div>` : '';
    const actions = [];
    if (canApply) actions.push(`<button class="primary" data-action="open-apply" data-id="${escapeHtml(demand.id)}">申请参与</button>`);
    if (myApplication) actions.push(`<span class="tag">我的申请：${escapeHtml(myApplication.status === 'accepted' ? '已确定' : myApplication.status === 'rejected' ? '未选中' : '等待确认')}</span>`);
    if (canProgress && demand.status === 'assigned') actions.push(`<button class="primary" data-action="set-status" data-id="${escapeHtml(demand.id)}" data-status="development">开始开发</button>`);
    if (canProgress && demand.status === 'development') actions.push(`<button class="primary" data-action="open-collab" data-id="${escapeHtml(demand.id)}">进入协作模块</button><button class="secondary" data-action="set-status" data-id="${escapeHtml(demand.id)}" data-status="testing">提交需求方试用</button>`);
    if ((own || isAdmin()) && demand.status === 'testing') actions.push(`<button class="success" data-action="set-status" data-id="${escapeHtml(demand.id)}" data-status="completed">完成本轮实践</button><button class="secondary" data-action="set-status" data-id="${escapeHtml(demand.id)}" data-status="development">继续完善</button>`);
    if (canProgress && demand.status === 'completed' && demand.allowShowcase) actions.push(`<button class="primary" data-action="open-works" data-id="${escapeHtml(demand.id)}">提交作品展示</button>`);
    return `<article class="card">
      <div class="card-head"><div><h3>${escapeHtml(demand.title)}</h3><div class="meta">${escapeHtml(demand.id)} · ${escapeHtml(unitText(demand))} · ${escapeHtml(demand.createdAt || '')}</div></div><span class="status ${escapeHtml(demand.status)}">${escapeHtml(statusNames[demand.status] || demand.status)}</span></div>
      <div class="tags"><span class="tag">${escapeHtml(demand.ownerType || '其他')}</span><span class="tag">${escapeHtml(demand.difficulty || '待评估')}</span><span class="tag">使用对象：${escapeHtml(demand.audience || '未填写')}</span></div>
      <div class="detail-grid"><div class="detail"><b>应用场景</b>${escapeHtml(demand.scene || '见视频或附件')}</div><div class="detail"><b>当前问题</b>${escapeHtml(demand.problem || '见视频或附件')}</div><div class="detail"><b>主要功能</b>${escapeHtml(demand.features || '见视频或附件')}</div><div class="detail"><b>项目团队</b>${escapeHtml(demand.teamLeaderName || '尚未确定')}</div></div>
      ${demand.videoUrl ? `<div class="summary">视频说明：<a href="${escapeHtml(demand.videoUrl)}" target="_blank" rel="noopener">打开视频或网盘链接</a></div>` : ''}
      ${filesHtml(demand.files)}${contact}${applicationsHtml(demand)}
      ${actions.length ? `<div class="actions">${actions.join('')}</div>` : ''}
    </article>`;
  }

  function renderMarket() {
    const type = $('marketType').value;
    const difficulty = $('marketDifficulty').value;
    const visible = state.demands.filter(item => ['recruiting','assigned','development','testing','completed'].includes(item.status) && (!type || item.ownerType === type) && (!difficulty || item.difficulty === difficulty));
    $('marketList').innerHTML = visible.map(item => demandCard(item)).join('') || '<div class="empty">当前没有符合条件的公开需求。</div>';
  }

  function renderMine() {
    const list = state.demands.filter(item => item.ownerPhone === state.user?.phone);
    $('mineList').innerHTML = list.map(item => demandCard(item, 'mine')).join('') || '<div class="empty">你还没有发布需求。</div>';
  }

  function renderParticipation() {
    const ids = new Set(state.applications.filter(item => item.applicantPhone === state.user?.phone).map(item => item.demandId));
    const list = state.demands.filter(item => ids.has(item.id) || item.teamLeaderPhone === state.user?.phone);
    $('participationList').innerHTML = list.map(item => demandCard(item, 'participation')).join('') || `<div class="empty">${isTeamMember() ? '你还没有申请参与项目。' : '认证为团队成员后，才可以申请参与真实需求。'}</div>`;
  }

  function renderNotices() {
    $('noticeList').innerHTML = state.notifications.map(item => `<article class="card"><div class="card-head"><div><h3>${escapeHtml(item.title)}</h3><div class="meta">${escapeHtml(item.createdAt || '')}</div></div><span class="status">${item.read ? '已读' : '未读'}</span></div><div class="summary">${escapeHtml(item.message || '')}</div></article>`).join('') || '<div class="empty">暂无通知。</div>';
    const unread = state.notifications.filter(item => !item.read).length;
    $('noticeBadge').textContent = unread;
    $('noticeBadge').classList.toggle('hidden', !unread);
  }

  function renderAdmin() {
    if (!isAdmin()) return;
    const pending = state.demands.filter(item => item.status === 'pending_review');
    $('reviewDemandList').innerHTML = pending.map(item => `<article class="card"><h3>${escapeHtml(item.title)}</h3><div class="meta">${escapeHtml(item.ownerName)} · ${escapeHtml(item.ownerType)} · ${escapeHtml(item.ownerOrganization || '')}</div><div class="summary">${escapeHtml(item.scene)}\n${escapeHtml(item.features)}</div><label><span>项目难度</span><select id="difficulty-${escapeHtml(item.id)}"><option>菜鸟级</option><option>入门级</option><option selected>实战级</option><option>工程级</option><option>综合级</option></select></label><div class="actions"><button class="success" data-action="review-demand" data-id="${escapeHtml(item.id)}" data-result="approved">通过并进入广场</button><button class="danger" data-action="review-demand" data-id="${escapeHtml(item.id)}" data-result="rejected">退回</button></div></article>`).join('') || '<div class="empty">没有待审核需求。</div>';
    const pendingProfiles = state.profiles.filter(item => item.teamStatus === 'pending');
    $('reviewTeamList').innerHTML = pendingProfiles.map(item => `<article class="card"><h3>${escapeHtml(item.name)}</h3><div class="meta">${escapeHtml(item.identityType)} · ${escapeHtml(item.organization)}</div><div class="summary">${escapeHtml(item.teamApplication || item.bio || '')}</div><div class="actions"><button class="success" data-action="review-team" data-phone="${escapeHtml(item.phone)}" data-result="approved">认证团队成员</button><button class="danger" data-action="review-team" data-phone="${escapeHtml(item.phone)}" data-result="rejected">不通过</button></div></article>`).join('') || '<div class="empty">没有团队成员申请。</div>';
  }

  function renderProfile() {
    $('publisherProfile').textContent = profileComplete() ? `发布人：${state.user.name} ｜ ${state.profile.identityType} ｜ ${state.profile.organization} ｜ 联系方式已受保护` : '请先完善个人资料后发布需求';
    $('teamApplyBtn').textContent = state.profile?.teamStatus === 'approved' ? '已认证团队成员' : state.profile?.teamStatus === 'pending' ? '团队认证审核中' : '申请团队成员';
    $('teamApplyBtn').disabled = ['approved','pending'].includes(state.profile?.teamStatus);
  }

  function renderAll() {
    $('userText').textContent = state.user ? `${state.user.name} · ${isAdmin() ? '管理员' : state.profile?.identityType || '资料未完善'}` : '未登录';
    document.querySelectorAll('.admin-only').forEach(el => el.classList.toggle('hidden', !isAdmin()));
    renderProfile(); renderMarket(); renderMine(); renderParticipation(); renderNotices(); renderAdmin();
  }

  function openProfile() {
    $('profileType').value = state.profile?.identityType || '';
    $('profileOrg').value = state.profile?.organization || '';
    $('profileDepartment').value = state.profile?.department || '';
    $('profileRegion').value = state.profile?.region || '';
    $('profileWechat').value = state.profile?.wechat || '';
    $('profileEmail').value = state.profile?.email || '';
    $('profileBio').value = state.profile?.bio || '';
    $('profileModal').classList.add('open');
  }

  async function filesPayload(fileList) {
    const result = [];
    for (const file of Array.from(fileList || []).slice(0, 8)) {
      if (file.size > 4 * 1024 * 1024) throw new Error(`${file.name} 超过4MB，请改用链接或压缩后上传`);
      const dataBase64 = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] || ''); reader.onerror = reject; reader.readAsDataURL(file); });
      result.push({ name: file.name, type: file.type, dataBase64 });
    }
    return result;
  }

  async function handleAction(button) {
    const action = button.dataset.action;
    try {
      if (action === 'open-apply') {
        const demand = state.demands.find(item => item.id === button.dataset.id);
        $('applyDemandId').value = demand.id; $('applyDemandName').textContent = demand.title; $('applyModal').classList.add('open'); return;
      }
      if (action === 'download') {
        const data = await api({ action: 'downloadDemandFile', objectKey: button.dataset.key });
        const binary = atob(data.dataBase64 || ''); const bytes = new Uint8Array(binary.length); for (let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
        const url = URL.createObjectURL(new Blob([bytes], { type: data.type || 'application/octet-stream' })); const link = document.createElement('a'); link.href=url; link.download=data.name || button.dataset.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); return;
      }
      if (action === 'review-demand') await api({ action: 'reviewDemand', demandId: button.dataset.id, result: button.dataset.result, difficulty: $(`difficulty-${button.dataset.id}`)?.value || '实战级' });
      if (action === 'review-team') await api({ action: 'reviewTeamMember', targetPhone: button.dataset.phone, result: button.dataset.result });
      if (action === 'accept-application' || action === 'reject-application') await api({ action: 'decideDemandApplication', applicationId: button.dataset.id, result: action === 'accept-application' ? 'accepted' : 'rejected' });
      if (action === 'set-status') await api({ action: 'updateDemandStatus', demandId: button.dataset.id, status: button.dataset.status });
      if (action === 'open-collab') { sessionStorage.setItem('ai-demand-handoff', JSON.stringify(state.demands.find(item => item.id === button.dataset.id))); parent.postMessage({ type: 'DEMAND_OPEN_COLLAB' }, location.origin); return; }
      if (action === 'open-works') { sessionStorage.setItem('ai-demand-handoff', JSON.stringify(state.demands.find(item => item.id === button.dataset.id))); parent.postMessage({ type: 'DEMAND_OPEN_WORKS' }, location.origin); return; }
      toast('操作已提交'); await loadDashboard();
    } catch (err) { toast(err.message); }
  }

  function bind() {
    document.querySelectorAll('.nav').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
    $('marketType').addEventListener('change', renderMarket); $('marketDifficulty').addEventListener('change', renderMarket);
    $('profileBtn').addEventListener('click', openProfile); $('profileCloseBtn').addEventListener('click', () => $('profileModal').classList.remove('open'));
    $('applyCloseBtn').addEventListener('click', () => $('applyModal').classList.remove('open'));
    $('refreshBtn').addEventListener('click', loadDashboard);
    document.addEventListener('click', event => { const button = event.target.closest('[data-action]'); if (button) handleAction(button); });

    $('profileForm').addEventListener('submit', async event => {
      event.preventDefault();
      try {
        await api({ action: 'saveDemandProfile', profile: { identityType: $('profileType').value, organization: $('profileOrg').value.trim(), department: $('profileDepartment').value.trim(), region: $('profileRegion').value.trim(), wechat: $('profileWechat').value.trim(), email: $('profileEmail').value.trim(), bio: $('profileBio').value.trim() } });
        $('profileModal').classList.remove('open'); toast('个人资料保存成功'); await loadDashboard();
      } catch (err) { toast(err.message); }
    });

    $('demandForm').addEventListener('submit', async event => {
      event.preventDefault();
      if (!profileComplete()) return openProfile();
      const button = $('submitDemandBtn'); button.disabled = true; button.textContent = '正在提交...';
      try {
        const files = await filesPayload($('demandFiles').files);
        const hasDescription = $('demandScene').value.trim() || $('demandProblem').value.trim() || $('demandFeatures').value.trim() || $('demandVideoUrl').value.trim() || files.length;
        if (!hasDescription) throw new Error('请通过文字、视频链接或附件至少提供一种需求说明');
        await api({ action: 'submitDemand', demand: { title: $('demandTitle').value.trim(), audience: $('demandAudience').value.trim(), scene: $('demandScene').value.trim(), problem: $('demandProblem').value.trim(), features: $('demandFeatures').value.trim(), deadline: $('demandDeadline').value, visibility: $('demandVisibility').value, videoUrl: $('demandVideoUrl').value.trim(), allowContact: $('allowContact').checked, allowTeaching: $('allowTeaching').checked, allowShowcase: $('allowShowcase').checked }, files });
        event.target.reset(); $('demandSubmitState').textContent = '提交成功，需求已进入管理员审核队列。'; $('demandSubmitState').className = 'submit-state ok'; toast('需求提交成功'); await loadDashboard(); switchView('mine');
      } catch (err) { $('demandSubmitState').textContent = `提交失败：${err.message}`; $('demandSubmitState').className = 'submit-state error'; }
      finally { button.disabled = false; button.textContent = '提交管理员审核'; }
    });

    $('applyForm').addEventListener('submit', async event => {
      event.preventDefault();
      try { await api({ action: 'applyDemand', demandId: $('applyDemandId').value, message: $('applyMessage').value.trim(), roleWanted: $('applyRole').value }); $('applyModal').classList.remove('open'); event.target.reset(); toast('参与申请提交成功'); await loadDashboard(); }
      catch (err) { toast(err.message); }
    });

    $('teamApplyBtn').addEventListener('click', async () => {
      if (!profileComplete()) return openProfile();
      const message = prompt('请简要说明擅长方向、项目经验和可投入时间：');
      if (!message) return;
      try { await api({ action: 'applyTeamMember', message }); toast('团队成员申请已提交'); await loadDashboard(); } catch (err) { toast(err.message); }
    });

    $('markReadBtn').addEventListener('click', async () => { try { await api({ action: 'markDemandNotificationsRead', ids: state.notifications.map(item => item.id) }); toast('通知已标记为已读'); await loadDashboard(); } catch (err) { toast(err.message); } });
    window.addEventListener('message', event => { if (event.origin === location.origin && event.data?.type === 'DS_PLATFORM_USER') { state.user = event.data.user; initUser(); } });
  }

  function initUser() {
    if (!state.user) { $('userText').textContent = '请从主平台登录后进入'; return; }
    loadDashboard();
  }

  bind();
  state.user = readParentUser();
  initUser();
})();
