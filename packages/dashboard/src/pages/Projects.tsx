import { useState, useEffect, useCallback } from 'react';
import { projectsApi, ApiError, type Project, type CreateProjectDto } from '../api';
import { LoadingSpinner } from '../components/LoadingSpinner';

const emptyForm: CreateProjectDto = {
  name: '',
  git_remote: '',
  aliases: [],
  description: '',
};

export function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CreateProjectDto & { aliasInput: string }>({
    ...emptyForm,
    aliasInput: '',
  });
  const [formError, setFormError] = useState('');
  const [formLoading, setFormLoading] = useState(false);

  // Per-project alias adding state
  const [addAliasFor, setAddAliasFor] = useState<string | null>(null);
  const [aliasInput, setAliasInput] = useState('');
  const [aliasLoading, setAliasLoading] = useState(false);

  // Resolve lookup
  const [resolveName, setResolveName] = useState('');
  const [resolveResult, setResolveResult] = useState<Project | null>(null);
  const [resolveError, setResolveError] = useState('');
  const [resolveLoading, setResolveLoading] = useState(false);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await projectsApi.list();
      setProjects(result.data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchProjects(); }, [fetchProjects]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { setFormError('Name is required'); return; }
    setFormLoading(true);
    setFormError('');
    try {
      const aliases = form.aliasInput
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      await projectsApi.create({
        name: form.name.trim(),
        git_remote: form.git_remote?.trim() || undefined,
        description: form.description?.trim() || undefined,
        aliases: aliases.length ? aliases : undefined,
      });
      setForm({ ...emptyForm, aliasInput: '' });
      setShowForm(false);
      void fetchProjects();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Failed to create project');
    } finally {
      setFormLoading(false);
    }
  };

  const handleAddAlias = async (projectId: string) => {
    const newAliases = aliasInput.split(',').map(s => s.trim()).filter(Boolean);
    if (!newAliases.length) return;
    setAliasLoading(true);
    try {
      await projectsApi.addAliases(projectId, newAliases);
      setAddAliasFor(null);
      setAliasInput('');
      void fetchProjects();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Failed to add alias');
    } finally {
      setAliasLoading(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete project "${name}"? This cannot be undone.`)) return;
    try {
      await projectsApi.delete(id);
      void fetchProjects();
    } catch (e) {
      alert(e instanceof ApiError ? e.message : 'Delete failed');
    }
  };

  const handleResolve = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolveName.trim()) return;
    setResolveLoading(true);
    setResolveError('');
    setResolveResult(null);
    try {
      const result = await projectsApi.resolve(resolveName.trim());
      setResolveResult(result.data);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setResolveError('No project found with that name or alias.');
      } else {
        setResolveError(e instanceof ApiError ? e.message : 'Lookup failed');
      }
    } finally {
      setResolveLoading(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Projects</h1>
        <button className="btn btn-primary" onClick={() => setShowForm(v => !v)}>
          {showForm ? '✕ Cancel' : '+ New Project'}
        </button>
      </div>

      {showForm && (
        <div className="inline-form">
          <form onSubmit={handleCreate}>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Name *</label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="my-project"
                />
              </div>
              <div className="form-group">
                <label className="form-label">Git Remote</label>
                <input
                  value={form.git_remote}
                  onChange={e => setForm(f => ({ ...f, git_remote: e.target.value }))}
                  placeholder="git@github.com:org/repo.git"
                />
              </div>
              <div className="form-group full-width">
                <label className="form-label">Aliases (comma-separated)</label>
                <input
                  value={form.aliasInput}
                  onChange={e => setForm(f => ({ ...f, aliasInput: e.target.value }))}
                  placeholder="repo-name, short-name, …"
                />
              </div>
              <div className="form-group full-width">
                <label className="form-label">Description</label>
                <textarea
                  rows={2}
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  style={{ width: '100%' }}
                />
              </div>
            </div>
            {formError && <div className="error-banner" style={{ marginTop: 12 }}>{formError}</div>}
            <div className="form-row">
              <button type="button" className="btn btn-secondary" onClick={() => { setShowForm(false); setForm({ ...emptyForm, aliasInput: '' }); }}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={formLoading}>
                {formLoading ? 'Creating…' : 'Create Project'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Resolve lookup */}
      <div className="card">
        <div className="card-title">Resolve Name / Alias</div>
        <form onSubmit={handleResolve}>
          <div className="resolve-box">
            <input
              type="text"
              placeholder="Enter name or alias…"
              value={resolveName}
              onChange={e => setResolveName(e.target.value)}
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn btn-secondary" disabled={resolveLoading}>
              {resolveLoading ? 'Resolving…' : 'Resolve'}
            </button>
          </div>
        </form>
        {resolveError && <div className="error-banner" style={{ marginTop: 10 }}>{resolveError}</div>}
        {resolveResult && (
          <div className="resolve-result">
            <strong>{resolveResult.name}</strong>
            {resolveResult.git_remote && (
              <span style={{ marginLeft: 10, color: 'var(--text3)', fontSize: 12 }}>{resolveResult.git_remote}</span>
            )}
            <br />
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>ID: {resolveResult.id}</span>
            {resolveResult.aliases.length > 0 && (
              <div className="chips" style={{ marginTop: 8 }}>
                {resolveResult.aliases.map(a => <span key={a} className="chip">{a}</span>)}
              </div>
            )}
          </div>
        )}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <LoadingSpinner />
      ) : projects.length === 0 ? (
        <div className="empty-state">
          <div style={{ fontSize: 32 }}>📂</div>
          <p>No projects yet. Create one to get started.</p>
        </div>
      ) : (
        projects.map(project => (
          <div key={project.id} className="project-row">
            <div className="project-row-header">
              <div>
                <div className="project-name">{project.name}</div>
                {project.git_remote && (
                  <div className="project-meta">{project.git_remote}</div>
                )}
                {project.description && (
                  <div className="project-meta" style={{ marginTop: 4 }}>{project.description}</div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setAddAliasFor(addAliasFor === project.id ? null : project.id);
                    setAliasInput('');
                  }}
                >
                  + Alias
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => void handleDelete(project.id, project.name)}
                >
                  Delete
                </button>
              </div>
            </div>

            {project.aliases.length > 0 && (
              <div className="chips" style={{ marginBottom: 8 }}>
                {project.aliases.map(a => <span key={a} className="chip">{a}</span>)}
              </div>
            )}

            {addAliasFor === project.id && (
              <div className="add-alias-inline">
                <input
                  type="text"
                  placeholder="alias1, alias2, …"
                  value={aliasInput}
                  onChange={e => setAliasInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void handleAddAlias(project.id); } }}
                  style={{ flex: 1 }}
                  autoFocus
                />
                <button
                  className="btn btn-primary btn-sm"
                  disabled={aliasLoading}
                  onClick={() => void handleAddAlias(project.id)}
                >
                  {aliasLoading ? 'Saving…' : 'Add'}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => { setAddAliasFor(null); setAliasInput(''); }}
                >
                  Cancel
                </button>
              </div>
            )}

            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8 }}>
              Created {new Date(project.created_at).toLocaleDateString()} · ID: {project.id}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
