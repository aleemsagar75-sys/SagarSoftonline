const API = ((base) => ({
  base,
  async request(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(base + path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok && !data.success) throw new Error(data.message || `Request failed (${res.status})`);
    return data;
  },
  getSchools: () => API.request('GET', '/api/admin/schools'),
  getSchool: (id) => API.request('GET', '/api/admin/schools/' + encodeURIComponent(id)),
  createSchool: (data) => API.request('POST', '/api/admin/schools', data),
  updateSchool: (id, data) => API.request('PUT', '/api/admin/schools/' + encodeURIComponent(id), data),
  deleteSchool: (id) => API.request('DELETE', '/api/admin/schools/' + encodeURIComponent(id)),
  health: () => API.request('GET', '/health'),
}))('/api' + '');

const Store = ((initial) => {
  let state = { ...initial }, listeners = [];
  return {
    get: (k) => state[k],
    set: (k, v) => { state[k] = v; listeners.forEach(fn => fn(k, v)); },
    setAll: (partial) => { state = { ...state, ...partial }; listeners.forEach(fn => fn('*', state)); },
    on: (fn) => { listeners.push(fn); return () => { listeners = listeners.filter(f => f !== fn); }; },
  };
})({ schools: [], loading: false, search: '' });

const Toast = {
  container: null,
  init() {
    this.container = document.getElementById('toastContainer');
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = 'toastContainer';
      this.container.className = 'toast-container';
      document.body.appendChild(this.container);
    }
  },
  show(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = msg;
    this.container.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .25s'; setTimeout(() => el.remove(), 250); }, 3000);
  },
  success: (m) => Toast.show(m, 'success'),
  error: (m) => Toast.show(m, 'error'),
  info: (m) => Toast.show(m, 'info'),
};

const Loading = {
  el: null,
  init() {
    this.el = document.getElementById('loadingOverlay');
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.id = 'loadingOverlay';
      this.el.className = 'loading-overlay';
      this.el.innerHTML = '<div class="spinner"></div>';
      document.body.appendChild(this.el);
    }
  },
  show() { this.el.classList.add('open'); },
  hide() { this.el.classList.remove('open'); },
};

const Modal = {
  el: null, titleEl: null, bodyEl: null, footerEl: null,
  init() {
    this.el = document.getElementById('modalOverlay');
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.id = 'modalOverlay';
      this.el.className = 'modal-overlay';
      this.el.innerHTML = `<div class="modal"><div class="modal-header"><h3 id="modalTitle"></h3><button class="modal-close" onclick="Modal.close()">&times;</button></div><div class="modal-body" id="modalBody"></div><div class="modal-footer" id="modalFooter"></div></div>`;
      document.body.appendChild(this.el);
    }
    this.titleEl = document.getElementById('modalTitle');
    this.bodyEl = document.getElementById('modalBody');
    this.footerEl = document.getElementById('modalFooter');
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.close(); });
  },
  open(title, bodyHTML, footerHTML) {
    this.titleEl.textContent = title;
    this.bodyEl.innerHTML = bodyHTML;
    this.footerEl.innerHTML = footerHTML || '';
    this.el.classList.add('open');
  },
  close() { this.el.classList.remove('open'); },
};

const Confirm = {
  async show(message, type = 'warning') {
    const icons = { danger: '&#9888;', warning: '&#9888;', info: '&#8505;' };
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay confirm-dialog open';
      overlay.innerHTML = `<div class="modal"><div class="modal-body"><div class="confirm-icon ${type}">${icons[type] || icons.warning}</div><p style="font-size:15px;color:var(--text-2);">${message}</p></div><div class="modal-footer"><button class="btn btn-outline" id="confirmCancel">Cancel</button><button class="btn btn-danger" id="confirmOk">Confirm</button></div></div>`;
      document.body.appendChild(overlay);
      overlay.querySelector('#confirmCancel').onclick = () => { overlay.remove(); resolve(false); };
      overlay.querySelector('#confirmOk').onclick = () => { overlay.remove(); resolve(true); };
      overlay.onclick = (e) => { if (e.target === overlay) { overlay.remove(); resolve(false); } };
    });
  },
};

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function formatDate(d) {
  if (!d) return '-';
  const date = new Date(d);
  if (isNaN(date)) return d.slice ? d.slice(0, 10) : '-';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function renderStats(schools) {
  const total = schools.length;
  const active = schools.filter(s => s.status === 'active' && !s.modules_locked).length;
  const inactive = schools.filter(s => s.status !== 'active').length;
  const locked = schools.filter(s => s.modules_locked).length;
  document.getElementById('statTotal').textContent = total;
  document.getElementById('statActive').textContent = active;
  document.getElementById('statInactive').textContent = inactive + locked;
}

function renderTable(schools) {
  const tbody = document.getElementById('schoolsTableBody');
  const search = Store.get('search').toLowerCase();
  const filtered = schools.filter(s =>
    (s.school_id || '').toLowerCase().includes(search) ||
    (s.school_name || '').toLowerCase().includes(search) ||
    (s.email || '').toLowerCase().includes(search)
  );
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">&#128209;</div><p>${search ? 'No schools match your search.' : 'No schools found. Add your first school!'}</p></div></td></tr>`;
    return;
  }
  let html = '';
  for (const s of filtered) {
    let statusClass = 'inactive', statusLabel = 'Inactive';
    if (s.status === 'active' && !s.modules_locked) { statusClass = 'active'; statusLabel = 'Active'; }
    else if (s.modules_locked) { statusClass = 'locked'; statusLabel = 'Locked'; }
    html += `<tr>
      <td><span class="mono">${escapeHTML(s.school_id)}</span></td>
      <td><strong>${escapeHTML(s.school_name)}</strong></td>
      <td>${escapeHTML(s.email)}</td>
      <td>${escapeHTML(s.plan || '-')}</td>
      <td>${formatDate(s.start_date)}</td>
      <td>${formatDate(s.expiry_date)}</td>
      <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
      <td>
        <div class="actions">
          <button class="btn btn-sm btn-outline" onclick="App.editSchool('${escapeHTML(s.school_id)}')">Edit</button>
          <button class="btn btn-sm btn-outline" onclick="App.toggleSchool('${escapeHTML(s.school_id)}')">${s.status === 'active' && !s.modules_locked ? 'Deactivate' : 'Activate'}</button>
          <button class="btn btn-sm btn-danger" onclick="App.deleteSchool('${escapeHTML(s.school_id)}')">Delete</button>
        </div>
      </td>
    </tr>`;
  }
  tbody.innerHTML = html;
}

const App = {
  currentEditId: null,
  async init() {
    Toast.init(); Loading.init(); Modal.init();
    document.getElementById('searchInput').addEventListener('input', (e) => {
      Store.set('search', e.target.value);
      renderTable(Store.get('schools'));
    });
    Store.on(() => renderTable(Store.get('schools')));
    await this.loadSchools();
    this.checkHealth();
    document.getElementById('addSchoolBtn').addEventListener('click', () => this.showSchoolForm());
    document.getElementById('schoolForm').addEventListener('submit', (e) => this.handleFormSubmit(e));
  },
  async checkHealth() {
    try {
      const h = await API.health();
      document.getElementById('connDot').className = 'dot online';
      document.getElementById('connText').textContent = 'Connected';
    } catch { }
  },
  async loadSchools() {
    Loading.show();
    try {
      const data = await API.getSchools();
      const schools = data.schools || [];
      Store.setAll({ schools });
      renderStats(schools);
      renderTable(schools);
    } catch (err) {
      Toast.error('Failed to load schools: ' + err.message);
    } finally { Loading.hide(); }
  },
  showSchoolForm(school) {
    this.currentEditId = school ? school.school_id : null;
    const title = school ? 'Edit School' : 'Add New School';
    const body = `
      <div class="form-group">
        <label>School Name</label>
        <input type="text" id="fSchoolName" value="${escapeHTML(school ? school.school_name : '')}" required>
      </div>
      <div class="form-group">
        <label>Email</label>
        <input type="email" id="fEmail" value="${escapeHTML(school ? school.email : '')}" ${school ? '' : 'required'}>
      </div>
      <div class="form-group">
        <label>Password ${school ? '<span style="font-weight:400;color:var(--text-3);font-size:12px;">(leave blank to keep existing)</span>' : ''}</label>
        <input type="text" id="fPassword" value="" ${school ? '' : 'required'}>
      </div>
      <div class="form-group">
        <label>Plan</label>
        <select id="fPlan">
          <option value="premium" ${school && school.plan === 'premium' ? 'selected' : ''}>Premium</option>
          <option value="standard" ${school && school.plan === 'standard' ? 'selected' : ''}>Standard</option>
          <option value="basic" ${school && school.plan === 'basic' ? 'selected' : ''}>Basic</option>
          <option value="trial" ${school && school.plan === 'trial' ? 'selected' : ''}>Trial</option>
        </select>
      </div>
      <div class="form-group">
        <label>Start Date</label>
        <input type="date" id="fStartDate" value="${school && school.start_date ? school.start_date.slice(0, 10) : ''}">
      </div>
      <div class="form-group">
        <label>Expiry Date</label>
        <input type="date" id="fExpiryDate" value="${school && school.expiry_date ? school.expiry_date.slice(0, 10) : ''}">
      </div>`;
    const footer = `<button class="btn btn-outline" onclick="Modal.close()">Cancel</button>
      <button class="btn btn-accent" id="formSubmitBtn">${school ? 'Update School' : 'Add School'}</button>`;
    Modal.open(title, body, footer);
    document.getElementById('formSubmitBtn').addEventListener('click', () => this.handleFormSubmit());
  },
  async handleFormSubmit() {
    const name = document.getElementById('fSchoolName');
    const email = document.getElementById('fEmail');
    const password = document.getElementById('fPassword');
    const plan = document.getElementById('fPlan');
    const start = document.getElementById('fStartDate');
    const expiry = document.getElementById('fExpiryDate');
    if (!name || !name.value.trim()) { Toast.error('School name is required.'); return; }
    const body = { school_name: name.value.trim() };
    if (email && email.value.trim()) body.email = email.value.trim();
    if (password && password.value.trim()) body.password = password.value.trim();
    if (plan && plan.value) body.plan = plan.value;
    if (start && start.value) body.start_date = start.value;
    if (expiry && expiry.value) body.expiry_date = expiry.value;
    Loading.show();
    try {
      if (this.currentEditId) {
        await API.updateSchool(this.currentEditId, body);
        Toast.success('School updated successfully.');
      } else {
        const result = await API.createSchool(body);
        Toast.success('School added! ID: ' + (result.school_id || ''));
      }
      Modal.close();
      await this.loadSchools();
    } catch (err) {
      Toast.error(err.message || 'Save failed.');
    } finally { Loading.hide(); }
  },
  editSchool(id) {
    const school = Store.get('schools').find(s => s.school_id === id);
    if (school) this.showSchoolForm(school);
  },
  async toggleSchool(id) {
    const school = Store.get('schools').find(s => s.school_id === id);
    if (!school) return;
    const isActive = school.status === 'active' && !school.modules_locked;
    const confirmed = await Confirm.show(
      isActive ? `Deactivate school <strong>${escapeHTML(school.school_name)}</strong>? Students will not be able to log in.` : `Activate school <strong>${escapeHTML(school.school_name)}</strong>?`,
      isActive ? 'danger' : 'info'
    );
    if (!confirmed) return;
    Loading.show();
    try {
      const update = {
        status: isActive ? 'inactive' : 'active',
        modules_locked: isActive ? true : false,
      };
      if (!isActive) { update.modules_locked = false; }
      await API.updateSchool(id, update);
      Toast.success(isActive ? 'School deactivated.' : 'School activated.');
      await this.loadSchools();
    } catch (err) {
      Toast.error(err.message || 'Failed to update school.');
    } finally { Loading.hide(); }
  },
  async deleteSchool(id) {
    const school = Store.get('schools').find(s => s.school_id === id);
    if (!school) return;
    const confirmed = await Confirm.show(
      `Permanently delete <strong>${escapeHTML(school.school_name)}</strong> (${escapeHTML(school.school_id)})? This will also remove all associated data.`,
      'danger'
    );
    if (!confirmed) return;
    Loading.show();
    try {
      await API.deleteSchool(id);
      Toast.success('School deleted.');
      await this.loadSchools();
    } catch (err) {
      Toast.error(err.message || 'Delete failed.');
    } finally { Loading.hide(); }
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
