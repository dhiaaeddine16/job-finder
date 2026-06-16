'use client';

import React, { useEffect, useState, useRef } from 'react';
import { PlusCircle, Edit, Trash2, ExternalLink, X, Tag } from 'lucide-react';

function useDebounced(value: string, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export default function ProfilesPage() {
  const [profiles, setProfiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<any>({ full_name: '', profile_title: '', profile_description: '', projects: [], skills: [], jobs: [], education: [], certifications: [], github_profile: '' });
  const [showModal, setShowModal] = useState(false);

  const fetchProfiles = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/profiles');
      const jd = await res.json();
      setProfiles(jd.profiles || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { fetchProfiles(); }, []);

  const openNew = () => { setEditing(null); setForm({ full_name: '', profile_title: '', profile_description: '', projects: [], skills: [], jobs: [], education: [], certifications: [], github_profile: '' }); setShowModal(true); };

  const openEdit = (p: any) => { setEditing(p); setForm({ ...p, projects: p.projects || [], jobs: p.jobs || [], education: p.education || [], certifications: p.certifications || [], skills: p.skills || [] }); setShowModal(true); };

  const closeModal = () => { setShowModal(false); setEditing(null); }

  // close on ESC
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeModal(); };
    if (showModal) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showModal]);

  // project helpers
  const addProject = () => setForm((f:any) => ({ ...f, projects: [...(f.projects||[]), { name: '', url: '' }] }));
  const updateProject = (idx:number, key:string, value:string) => setForm((f:any) => { const projects = [...(f.projects||[])]; projects[idx] = { ...projects[idx], [key]: value }; return { ...f, projects }; });
  const removeProject = (idx:number) => setForm((f:any) => ({ ...f, projects: (f.projects||[]).filter((_:any,i:number)=>i!==idx) }));

  // education helpers
  const addEducation = () => setForm((f:any) => ({ ...f, education: [...(f.education||[]), { school: '', degree: '', year: '' }] }));
  const updateEducation = (idx:number, key:string, value:string) => setForm((f:any) => { const education = [...(f.education||[])]; education[idx] = { ...education[idx], [key]: value }; return { ...f, education }; });
  const removeEducation = (idx:number) => setForm((f:any) => ({ ...f, education: (f.education||[]).filter((_:any,i:number)=>i!==idx) }));

  // certifications helpers
  const addCertification = () => setForm((f:any) => ({ ...f, certifications: [...(f.certifications||[]), { name: '' }] }));
  const updateCertification = (idx:number, value:string) => setForm((f:any) => { const certifications = [...(f.certifications||[])]; certifications[idx] = { ...certifications[idx], name: value }; return { ...f, certifications }; });
  const removeCertification = (idx:number) => setForm((f:any) => ({ ...f, certifications: (f.certifications||[]).filter((_:any,i:number)=>i!==idx) }));

  // Save/delete
  const save = async () => {
    try {
      const method = editing ? 'PUT' : 'POST';
      const body = editing ? { id: editing.id, ...form } : form;
      const res = await fetch('/api/profiles', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const jd = await res.json();
      if (!res.ok) throw new Error(jd.error || 'Failed');
      closeModal();
      fetchProfiles();
    } catch (e) { alert(String(e)); }
  };

  const del = async (id: number) => {
    if (!confirm('Delete profile?')) return;
    try {
      const res = await fetch(`/api/profiles?id=${id}`, { method: 'DELETE' });
      const jd = await res.json();
      if (!res.ok) throw new Error(jd.error || 'Failed');
      fetchProfiles();
    } catch (e) { alert(String(e)); }
  };

  // Skills input with autocomplete
  function SkillsInput({ value, onChange }: { value: string[]; onChange: (v:string[])=>void }){
    const [text, setText] = useState('');
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const debounced = useDebounced(text, 250);
    const ref = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
      if (!debounced) { setSuggestions([]); return; }
      let cancelled = false;
      (async () => {
        try {
          const params = new URLSearchParams({ q: debounced, limit: '10' });
          const res = await fetch(`/api/skills?${params}`);
          const jd = await res.json();
          if (!cancelled && jd.skills) setSuggestions(jd.skills.map((s:any)=>s.name).filter((n:string)=>!value.includes(n)));
        } catch { /* ignore */ }
      })();
      return ()=>{ cancelled = true };
    }, [debounced, value]);

    useEffect(()=>{
      const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setShowSuggestions(false); };
      document.addEventListener('click', onDoc);
      return ()=>document.removeEventListener('click', onDoc);
    },[]);

    const addTag = (t:string)=>{
      if (!t) return;
      if (value.includes(t)) return;
      onChange([...value, t]);
      setText('');
      setShowSuggestions(false);
    }

    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>)=>{
      if (e.key === 'Enter' || e.key === ','){
        e.preventDefault();
        const v = text.trim().replace(/,$/, '');
        if (v) addTag(v);
      } else if (e.key === 'Backspace' && text === ''){
        // remove last
        onChange(value.slice(0, -1));
      }
    }

    return (
      <div className="relative" ref={ref}>
        <div className="flex flex-wrap gap-2 items-center">
          {value.map((s,i)=> (
            <span key={i} className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-950/30 border border-indigo-900/30 text-indigo-200">
              <Tag className="w-3 h-3 opacity-70" />
              {s}
              <button type="button" onClick={()=>onChange(value.filter(x=>x!==s))} className="ml-1 text-indigo-300/60 hover:text-indigo-200 px-1">×</button>
            </span>
          ))}

          <input
            value={text}
            onChange={e=>{ setText(e.target.value); setShowSuggestions(true); }}
            onKeyDown={onKeyDown}
            placeholder="Type skill and press Enter"
            className="min-w-[160px] bg-indigo-950/40 border border-indigo-900/30 rounded px-3 py-2 text-sm text-indigo-100"
          />
        </div>

        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute mt-2 w-full max-h-40 overflow-auto bg-indigo-950/60 border border-indigo-900/40 rounded shadow z-50">
            {suggestions.map((s,i)=>(
              <div key={i} onMouseDown={(ev)=>{ ev.preventDefault(); addTag(s); }} className="px-3 py-2 text-sm hover:bg-indigo-900/40 cursor-pointer">{s}</div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative z-10 p-8">
      <div className="glow-bg-radial top-[-80px] left-[30%]" />

      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-400 via-indigo-100 to-indigo-400 bg-clip-text text-transparent">Profiles</h2>
          <p className="text-sm text-indigo-200/50 mt-1">Manage your Upwork profiles stored in Postgres.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={openNew} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-600/15 border border-emerald-500/20 text-emerald-300 text-sm font-medium"> <PlusCircle className="w-4 h-4"/> New Profile</button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <div>
          <div className="glass-panel p-5">
            <h3 className="text-sm font-bold text-indigo-200 mb-3">Profiles (List view)</h3>
            {loading ? <div className="text-indigo-400">Loading...</div> : (
              <div className="space-y-4">
                {profiles.map(p => (
                  <div key={p.id} className="p-4 bg-indigo-950/6 border border-indigo-900/12 rounded-lg hover:shadow-lg transition">
                    <dl className="grid grid-cols-1 gap-2">

                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-lg bg-indigo-900/20 flex items-center justify-center text-indigo-300 font-extrabold text-lg">{(p.full_name || '').split(' ').map((s:string)=>s[0]).slice(0,2).join('')}</div>
                        <div className="min-w-0 flex-1">
                          <dt className="text-sm text-indigo-300">Full name</dt>
                          <dd className="text-lg font-extrabold text-indigo-100">{p.full_name}</dd>
                          {p.profile_title && <dd className="mt-1 inline-block text-sm font-semibold text-indigo-200 bg-indigo-900/8 px-2 py-0.5 rounded">{p.profile_title}</dd>}
                        </div>

                        <div className="flex gap-2 items-start">
                          <div className="text-xs text-indigo-400 mr-2">Created: {p.created_at ? new Date(p.created_at).toLocaleString() : '—'}</div>
                          <div className="flex gap-2">
                            <button onClick={()=>openEdit(p)} className="px-3 py-1 rounded bg-indigo-600/10 border border-indigo-900/20 text-indigo-100 text-sm flex items-center gap-2"><Edit className="w-4 h-4"/>Edit</button>
                            <button onClick={()=>del(p.id)} className="px-3 py-1 rounded border border-rose-500/20 text-rose-400 text-sm flex items-center gap-2"><Trash2 className="w-4 h-4"/>Delete</button>
                          </div>
                        </div>
                      </div>

                      <div>
                        <dt className="text-xs text-indigo-300">Description</dt>
                        <dd className="text-sm text-indigo-200">{p.profile_description || '—'}</dd>
                      </div>

                      <div>
                        <dt className="text-xs text-indigo-300">Skills</dt>
                        <dd className="mt-1">
                          {p.skills && p.skills.length>0 ? (
                            <div className="flex flex-wrap gap-2">
                              {p.skills.map((s:string,i:number)=> (
                                <span key={i} className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-950/30 border border-indigo-900/30 text-indigo-200">{s}</span>
                              ))}
                            </div>
                          ) : '—'}
                        </dd>
                      </div>

                      <div>
                        <dt className="text-xs text-indigo-300">Projects</dt>
                        <dd className="text-sm text-indigo-200">
                          {p.projects && p.projects.length>0 ? (
                            <ul className="list-disc ml-5">
                              {p.projects.map((pr:any, idx:number)=>(<li key={idx}><span className="font-medium text-indigo-100">{pr.name}</span>{pr.url?` — `:''}{pr.url && <a className="text-indigo-400 hover:underline" href={pr.url} target="_blank" rel="noreferrer">{pr.url}</a>}</li>))}
                            </ul>
                          ) : '—'}
                        </dd>
                      </div>

                      <div>
                        <dt className="text-xs text-indigo-300">Education</dt>
                        <dd className="text-sm text-indigo-200">
                          {p.education && p.education.length>0 ? (
                            <ul className="list-disc ml-5">
                              {p.education.map((ed:any, idx:number)=>(<li key={idx}><span className="font-medium text-indigo-100">{ed.school}</span>{ed.degree?`, ${ed.degree}`:''}{ed.year?`, ${ed.year}`:''}</li>))}
                            </ul>
                          ) : '—'}
                        </dd>
                      </div>

                      <div>
                        <dt className="text-xs text-indigo-300">Certifications</dt>
                        <dd className="text-sm text-indigo-200">
                          {p.certifications && p.certifications.length>0 ? (
                            <ul className="list-disc ml-5">{p.certifications.map((c:any, idx:number)=>(<li key={idx}>{c.name}</li>))}</ul>
                          ) : '—'}
                        </dd>
                      </div>

                      <div>
                        <dt className="text-xs text-indigo-300">Jobs</dt>
                        <dd className="text-sm text-indigo-200">
                          {p.jobs && p.jobs.length>0 ? (
                            <ul className="list-disc ml-5">{p.jobs.map((j:any, idx:number)=>(<li key={idx}>{j.title || j}</li>))}</ul>
                          ) : '—'}
                        </dd>
                      </div>

                      <div>
                        <dt className="text-xs text-indigo-300">GitHub</dt>
                        <dd className="text-sm text-indigo-200">{p.github_profile ? <a className="text-indigo-400 hover:underline" href={p.github_profile} target="_blank" rel="noreferrer">{p.github_profile}</a> : '—'}</dd>
                      </div>

                    </dl>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={closeModal} />
          <div className="relative bg-[#070619] w-full max-w-4xl mx-4 rounded-2xl border border-indigo-900/40 shadow-lg p-6 z-10">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-indigo-100">{editing ? 'Edit Profile' : 'New Profile'}</h3>
                <p className="text-xs text-indigo-400">{editing ? 'Modify profile and save' : 'Create a new Upwork profile'}</p>
              </div>
              <button onClick={closeModal} className="text-indigo-300/60 hover:text-indigo-200 p-2 rounded"><X className="w-4 h-4"/></button>
            </div>

            <div className="max-h-[70vh] overflow-auto pr-2">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-xs font-bold text-indigo-200/60">Full name</label>
                  <input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} className="w-full bg-indigo-950/40 border border-indigo-900/30 rounded px-4 py-3 text-base" />

                  <label className="block text-xs font-bold text-indigo-200/60 mt-3">Title</label>
                  <input value={form.profile_title} onChange={e => setForm({ ...form, profile_title: e.target.value })} className="w-full bg-indigo-950/40 border border-indigo-900/30 rounded px-4 py-3 text-base" />

                  <label className="block text-xs font-bold text-indigo-200/60 mt-3">GitHub</label>
                  <input value={form.github_profile} onChange={e => setForm({ ...form, github_profile: e.target.value })} className="w-full bg-indigo-950/40 border border-indigo-900/30 rounded px-4 py-3 text-base" />

                  <label className="block text-xs font-bold text-indigo-200/60 mt-3">Description</label>
                  <textarea value={form.profile_description} onChange={e => setForm({ ...form, profile_description: e.target.value })} className="w-full bg-indigo-950/40 border border-indigo-900/30 rounded px-4 py-3 text-base h-40" />
                </div>

                <div>
                  <label className="block text-xs font-bold text-indigo-200/60">Skills</label>
                  <SkillsInput value={form.skills || []} onChange={(v)=>setForm({...form, skills:v})} />

                  {/* Projects as dynamic inputs */}
                  <div className="mt-4">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-bold text-indigo-200/60">Projects</label>
                      <button onClick={addProject} className="text-indigo-300/60 hover:text-indigo-200 p-1 rounded text-xs flex items-center gap-1"><PlusCircle className="w-4 h-4"/>Add</button>
                    </div>
                    <div className="space-y-2 mt-2">
                      {(form.projects || []).map((pr:any, idx:number) => (
                        <div key={idx} className="flex gap-2">
                          <input value={pr.name || ''} onChange={e=>updateProject(idx,'name',e.target.value)} placeholder="Project name" className="flex-1 bg-indigo-950/40 border border-indigo-900/30 rounded px-3 py-2 text-sm" />
                          <input value={pr.url || ''} onChange={e=>updateProject(idx,'url',e.target.value)} placeholder="URL (optional)" className="w-48 bg-indigo-950/40 border border-indigo-900/30 rounded px-3 py-2 text-sm" />
                          <button onClick={()=>removeProject(idx)} className="px-2 py-1 rounded border border-rose-500/20 text-rose-400">Remove</button>
                        </div>
                      ))}
                      {!(form.projects || []).length && <div className="text-xs text-indigo-400">No projects yet.</div>}
                    </div>
                  </div>

                  {/* Education as dynamic inputs */}
                  <div className="mt-4">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-bold text-indigo-200/60">Education</label>
                      <button onClick={addEducation} className="text-indigo-300/60 hover:text-indigo-200 p-1 rounded text-xs flex items-center gap-1"><PlusCircle className="w-4 h-4"/>Add</button>
                    </div>
                    <div className="space-y-2 mt-2">
                      {(form.education || []).map((ed:any, idx:number) => (
                        <div key={idx} className="flex gap-2">
                          <input value={ed.school || ''} onChange={e=>updateEducation(idx,'school',e.target.value)} placeholder="School" className="flex-1 bg-indigo-950/40 border border-indigo-900/30 rounded px-3 py-2 text-sm" />
                          <input value={ed.degree || ''} onChange={e=>updateEducation(idx,'degree',e.target.value)} placeholder="Degree" className="w-40 bg-indigo-950/40 border border-indigo-900/30 rounded px-3 py-2 text-sm" />
                          <input value={ed.year || ''} onChange={e=>updateEducation(idx,'year',e.target.value)} placeholder="Year" className="w-24 bg-indigo-950/40 border border-indigo-900/30 rounded px-3 py-2 text-sm" />
                          <button onClick={()=>removeEducation(idx)} className="px-2 py-1 rounded border border-rose-500/20 text-rose-400">Remove</button>
                        </div>
                      ))}
                      {!(form.education || []).length && <div className="text-xs text-indigo-400">No education entries yet.</div>}
                    </div>
                  </div>

                  {/* Certifications */}
                  <div className="mt-4">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-bold text-indigo-200/60">Certifications</label>
                      <button onClick={addCertification} className="text-indigo-300/60 hover:text-indigo-200 p-1 rounded text-xs flex items-center gap-1"><PlusCircle className="w-4 h-4"/>Add</button>
                    </div>
                    <div className="space-y-2 mt-2">
                      {(form.certifications || []).map((c:any, idx:number) => (
                        <div key={idx} className="flex gap-2 items-center">
                          <input value={c.name || ''} onChange={e=>updateCertification(idx,e.target.value)} placeholder="Certification name" className="flex-1 bg-indigo-950/40 border border-indigo-900/30 rounded px-3 py-2 text-sm" />
                          <button onClick={()=>removeCertification(idx)} className="px-2 py-1 rounded border border-rose-500/20 text-rose-400">Remove</button>
                        </div>
                      ))}
                      {!(form.certifications || []).length && <div className="text-xs text-indigo-400">No certifications yet.</div>}
                    </div>
                  </div>

                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 justify-end mt-4">
              <button onClick={closeModal} className="px-4 py-2 rounded border border-indigo-900/30 text-indigo-300">Cancel</button>
              <button onClick={save} className="px-6 py-2 rounded bg-indigo-600/20 border border-indigo-500/20 text-indigo-100 font-bold">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
