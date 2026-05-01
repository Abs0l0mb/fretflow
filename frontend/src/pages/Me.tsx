import { useState, useEffect, FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import { useAuth } from '../contexts/AuthContext'

type Tab = 'data' | 'sessions'

interface MyData {
    id: number; email: string; last_name?: string; first_name?: string; access_right_names?: string[]
}

interface Session {
    id: number; create_date?: string; update_date?: string; last_ip?: string
    browser_name?: string; browser_version?: string; os_name?: string; os_version?: string; device_type?: string
}

export default function Me() {
    const { logout } = useAuth()
    const { t } = useTranslation()
    const [tab, setTab] = useState<Tab>('data')
    const [loggingOut, setLoggingOut] = useState(false)

    const TAB_LABELS: Record<Tab, string> = {
        data:     t('me.tab_data'),
        sessions: t('me.tab_sessions'),
    }

    return (
        <div className="page">
            <div className="page-header">
                <h1 className="page-title">{t('me.title')}</h1>
                <button className="btn btn-danger" onClick={async () => { setLoggingOut(true); try { await logout() } finally { setLoggingOut(false) } }} disabled={loggingOut}>
                    {loggingOut ? t('me.logging_out') : t('me.log_out')}
                </button>
            </div>

            <div className="tab-bar">
                {(['data', 'sessions'] as Tab[]).map(t => (
                    <button key={t} className={`tab-btn${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
                        {TAB_LABELS[t]}
                    </button>
                ))}
            </div>

            {tab === 'data'     && <DataTab />}
            {tab === 'sessions' && <SessionsTab />}
        </div>
    )
}

function DataTab() {
    const { t } = useTranslation()
    const [data, setData] = useState<MyData | null>(null)
    const [editing, setEditing] = useState(false)

    useEffect(() => { api.get('/me').then(setData).catch(() => {}) }, [])

    if (!data) return <div className="card empty-state">{t('me.loading')}</div>

    return (
        <div className="card">
            <div className="me-table-wrap">
                <table className="data-table">
                    <thead>
                        <tr>
                            {[t('me.col_id'), t('me.col_email'), t('me.col_last_name'), t('me.col_first_name'), t('me.col_access'), ''].map(h => <th key={h}>{h}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>{data.id}</td>
                            <td>{data.email}</td>
                            <td>{data.last_name || '—'}</td>
                            <td>{data.first_name || '—'}</td>
                            <td>{data.access_right_names?.join(', ') || '—'}</td>
                            <td>
                                <button className="btn btn-sm" onClick={() => setEditing(true)}>{t('me.edit')}</button>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            {editing && (
                <EditModal
                    initial={data}
                    onClose={() => setEditing(false)}
                    onSuccess={updated => { setData(d => d ? { ...d, ...updated } : d); setEditing(false) }}
                />
            )}
        </div>
    )
}

function EditModal({ initial, onClose, onSuccess }: {
    initial: MyData; onClose: () => void; onSuccess: (d: Partial<MyData>) => void
}) {
    const { t } = useTranslation()
    const [email, setEmail]         = useState(initial.email)
    const [lastName, setLastName]   = useState(initial.last_name || '')
    const [firstName, setFirstName] = useState(initial.first_name || '')
    const [password, setPassword]   = useState('')
    const [error, setError]         = useState('')
    const [loading, setLoading]     = useState(false)

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault(); setLoading(true); setError('')
        try {
            await api.post('/me/update', { email, lastName, firstName, password })
            onSuccess({ email, last_name: lastName, first_name: firstName })
        } catch (err: any) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    const fields = [
        { label: t('me.edit_email'),      value: email,     set: setEmail,     type: 'text' },
        { label: t('me.edit_last_name'),  value: lastName,  set: setLastName,  type: 'text' },
        { label: t('me.edit_first_name'), value: firstName, set: setFirstName, type: 'text' },
        { label: t('me.edit_password'),   value: password,  set: setPassword,  type: 'password' },
    ]

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <h3 className="modal-title">{t('me.edit_title')}</h3>
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {fields.map(({ label, value, set, type }) => (
                        <div key={label} className="field">
                            <label className="field-label">{label}</label>
                            <input className="input" type={type} value={value} onChange={e => set(e.target.value)} />
                        </div>
                    ))}
                    {error && <p className="input-error">{error}</p>}
                    <div className="modal-actions">
                        <button type="button" className="btn" onClick={onClose}>{t('me.cancel')}</button>
                        <button type="submit" className="btn btn-primary" disabled={loading}>
                            {loading ? t('me.updating') : t('me.update')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}

function SessionsTab() {
    const { t } = useTranslation()
    const [sessions, setSessions] = useState<Session[]>([])

    useEffect(() => { api.get('/me/sessions').then(setSessions).catch(() => {}) }, [])

    const fmt = (d?: string) => d ? new Date(d).toLocaleString() : '—'

    const handleDelete = async (id: number) => {
        if (!confirm(`Delete session ${id}?`)) return
        try {
            await api.post('/me/session/delete', { id })
            setSessions(prev => prev.filter(s => s.id !== id))
        } catch (e: any) { alert(e.message) }
    }

    if (!sessions.length) return <div className="card empty-state">{t('me.no_sessions')}</div>

    return (
        <div className="card">
            <div className="me-table-wrap">
                <table className="data-table">
                    <thead>
                        <tr>
                            {[t('me.col_id'), t('me.col_created'), t('me.col_updated'), t('me.col_last_ip'), t('me.col_browser'), t('me.col_os'), t('me.col_device'), ''].map(h => <th key={h}>{h}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {sessions.map(s => (
                            <tr key={s.id}>
                                <td>{s.id}</td>
                                <td>{fmt(s.create_date)}</td>
                                <td>{fmt(s.update_date)}</td>
                                <td>{s.last_ip || '—'}</td>
                                <td>{[s.browser_name, s.browser_version].filter(Boolean).join(' ') || '—'}</td>
                                <td>{[s.os_name, s.os_version].filter(Boolean).join(' ') || '—'}</td>
                                <td>{s.device_type || '—'}</td>
                                <td>
                                    <button className="btn btn-sm btn-danger" onClick={() => handleDelete(s.id)}>{t('me.delete')}</button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
