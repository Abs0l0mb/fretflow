import { useState, useRef, useCallback, useEffect } from 'react'
import * as at from '@coderline/alphatab'
import { api } from '../api'

// ── Parameter definitions ──────────────────────────────────────────

interface ParamDef { key: string; label: string; defaultValue: number; description?: string }
interface ParamGroup { title: string; params: ParamDef[] }

const PARAM_GROUPS: ParamGroup[] = [
    { title: 'Général', params: [
        { key: 'step',  label: 'Step (ticks)',    defaultValue: 60,  description: 'Quantization step in MIDI ticks.' },
        { key: 'gpq',   label: 'Quarter ticks',   defaultValue: 960, description: 'Duration of a quarter note in Guitar Pro ticks.' },
        { key: 'tempo', label: 'Tempo (BPM)',      defaultValue: 120, description: 'Playback tempo in beats per minute.' },
    ]},
    { title: 'Recherche', params: [
        { key: 'max_fret',    label: 'Max fret',    defaultValue: 20  },
        { key: 'per_pitch_k', label: 'Per pitch K', defaultValue: 4   },
        { key: 'chord_k',     label: 'Chord K',     defaultValue: 50  },
        { key: 'beam_size',   label: 'Beam size',   defaultValue: 100 },
    ]},
    { title: 'Coût local', params: [
        { key: 'w_span',                label: 'w_span',                defaultValue: 1.0  },
        { key: 'w_high',                label: 'w_high',                defaultValue: 0.2  },
        { key: 'high_fret_threshold',   label: 'High fret threshold',   defaultValue: 19   },
        { key: 'w_open_bonus',          label: 'w_open_bonus',          defaultValue: 0    },
        { key: 'w_string_range',        label: 'w_string_range',        defaultValue: 0.15 },
        { key: 'preferred_min_fret',    label: 'Preferred min fret',    defaultValue: 5    },
        { key: 'preferred_max_fret',    label: 'Preferred max fret',    defaultValue: 17   },
        { key: 'w_preferred_zone',      label: 'w_preferred_zone',      defaultValue: -1.5 },
        { key: 'high_string_threshold', label: 'High string threshold', defaultValue: 2    },
        { key: 'w_high_string',         label: 'w_high_string',         defaultValue: 2.0  },
    ]},
    { title: 'Accords', params: [
        { key: 'w_holes',  label: 'w_holes',  defaultValue: 4   },
        { key: 'w_gap',    label: 'w_gap',    defaultValue: 0.6 },
        { key: 'w_blocks', label: 'w_blocks', defaultValue: 4   },
    ]},
    { title: 'Affinité même corde', params: [
        { key: 'same_string_pitch_threshold', label: 'Pitch threshold (semitones)', defaultValue: 5    },
        { key: 'w_same_string_bonus',         label: 'w_same_string_bonus (< 0)',   defaultValue: -1.0 },
    ]},
    { title: 'Saut de corde', params: [
        { key: 'string_jump_threshold', label: 'String jump threshold', defaultValue: 1   },
        { key: 'w_string_jump',         label: 'w_string_jump',         defaultValue: 1.5 },
    ]},
    { title: 'Legato', params: [
        { key: 'allow_legato',      label: 'Allow legato (0/1)',      defaultValue: 0   },
        { key: 'max_fret_distance', label: 'Max fret distance',       defaultValue: 5   },
        { key: 'speed_threshold',   label: 'Speed threshold (ticks)', defaultValue: 480 },
    ]},
    { title: 'Tapping', params: [
        { key: 'allow_tapping',      label: 'Allow tapping (0/1)',  defaultValue: 0   },
        { key: 'tap_min_fret',       label: 'Tap min fret',         defaultValue: 7   },
        { key: 'w_tap_activation',   label: 'w_tap_activation',     defaultValue: 2.0 },
        { key: 'w_tap_deactivation', label: 'w_tap_deactivation',   defaultValue: 0.5 },
        { key: 'w_tap_jump',         label: 'w_tap_jump',           defaultValue: 1.0 },
    ]},
    { title: 'Coût de transition', params: [
        { key: 'w_jump',                  label: 'w_jump',                 defaultValue: 0.8  },
        { key: 'jump_power',              label: 'jump_power',             defaultValue: 1.2  },
        { key: 'jump_threshold',          label: 'jump_threshold',         defaultValue: 5    },
        { key: 'jump_threshold_penalty',  label: 'jump_threshold_penalty', defaultValue: 3.0  },
        { key: 'w_avg_jump',              label: 'w_avg_jump',             defaultValue: 0.6  },
        { key: 'avg_jump_power',          label: 'avg_jump_power',         defaultValue: 1.3  },
        { key: 'w_span_change',           label: 'w_span_change',          defaultValue: 0.25 },
        { key: 'w_string_center',         label: 'w_string_center',        defaultValue: 3    },
        { key: 'close_jump_threshold',    label: 'close_jump_threshold',   defaultValue: 4.0  },
        { key: 'close_jump_bonus',        label: 'close_jump_bonus',       defaultValue: -1.2 },
        { key: 'rest_enter_penalty',      label: 'rest_enter_penalty',     defaultValue: 0.0  },
        { key: 'rest_exit_penalty',       label: 'rest_exit_penalty',      defaultValue: 0.0  },
        { key: 'w_streak',               label: 'w_streak',               defaultValue: 4.0  },
        { key: 'streak_min_len',         label: 'streak_min_len',         defaultValue: 4    },
        { key: 'streak_speed_threshold', label: 'streak_speed_threshold', defaultValue: 480  },
    ]},
]

function buildDefaults(): Record<string, number> {
    const v: Record<string, number> = {}
    for (const g of PARAM_GROUPS) for (const p of g.params) v[p.key] = p.defaultValue
    return v
}

function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve((r.result as string).split(',')[1])
        r.onerror = reject
        r.readAsDataURL(file)
    })
}

// ── AlphaTab modal ─────────────────────────────────────────────────

interface AlphaTabModalProps {
    gp5Buffer: ArrayBuffer
    fileName: string
    onClose: () => void
}

function AlphaTabModal({ gp5Buffer, fileName, onClose }: AlphaTabModalProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const apiRef = useRef<at.AlphaTabApi | null>(null)
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
    const [errorMsg, setErrorMsg] = useState('')
    const [playing, setPlaying] = useState(false)

    useEffect(() => {
        if (!containerRef.current) return

        const api = new at.AlphaTabApi(containerRef.current, {
            core: {
                fontDirectory: '/font/',
                scriptFile: '/alphaTab.min.js',
            },
            player: {
                enablePlayer: true,
                enableCursor: true,
                soundFont: '/soundfont/sonivox.sf2',
            },
            display: { scale: 1.0 },
        })

        api.playerStateChanged.on((e: at.PlayerStateChangedEventArgs) => {
            setPlaying(e.state === at.synth.PlayerState.Playing)
        })
        api.scoreLoaded.on(() => setStatus('ready'))
        api.error.on((e: at.Error) => {
            setStatus('error')
            setErrorMsg(e.message ?? String(e))
        })

        api.load(new Uint8Array(gp5Buffer))
        apiRef.current = api

        return () => {
            api.destroy()
            apiRef.current = null
        }
    }, [gp5Buffer])

    // Close on Escape
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [onClose])

    const handleDownload = () => {
        const url = URL.createObjectURL(new Blob([gp5Buffer], { type: 'application/octet-stream' }))
        Object.assign(document.createElement('a'), { href: url, download: fileName }).click()
        URL.revokeObjectURL(url)
    }

    return (
        <div className="modal-overlay player-modal-overlay" onClick={onClose}>
            <div className="player-modal" onClick={e => e.stopPropagation()}>
                <div className="player-modal-header">
                    <div className="player-controls">
                        <button
                            className="btn btn-primary"
                            onClick={() => apiRef.current?.playPause()}
                            disabled={status !== 'ready'}
                        >
                            {playing ? '⏸ Pause' : '▶ Play'}
                        </button>
                        <button
                            className="btn"
                            onClick={() => apiRef.current?.stop()}
                            disabled={status !== 'ready'}
                        >
                            ■ Stop
                        </button>
                        <button className="btn" onClick={handleDownload}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                                <polyline points="7 10 12 15 17 10"/>
                                <line x1="12" y1="3" x2="12" y2="15"/>
                            </svg>
                            Download .gp5
                        </button>
                        {status === 'loading' && (
                            <span className="player-status">
                                <span className="btn-spinner" style={{ display: 'inline-block' }} /> Loading score…
                            </span>
                        )}
                        {status === 'error' && (
                            <span className="player-status player-status-error">
                                Error: {errorMsg}
                            </span>
                        )}
                    </div>
                    <button className="btn player-modal-close" onClick={onClose} title="Close (Esc)">
                        ✕
                    </button>
                </div>
                <div ref={containerRef} className="alphatab-container" />
            </div>
        </div>
    )
}

// ── Main Tabify page ───────────────────────────────────────────────

export default function Tabify() {
    const [file, setFile] = useState<File | null>(null)
    const [values, setValues] = useState<Record<string, number>>(buildDefaults)
    const [suggesting, setSuggesting] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState('')
    const [gp5Buffer, setGp5Buffer] = useState<ArrayBuffer | null>(null)
    const [gp5Name, setGp5Name] = useState('')

    const setParam = useCallback((key: string, value: number) => {
        setValues(prev => ({ ...prev, [key]: value }))
    }, [])

    const getFileParts = async () => {
        if (!file) return null
        return { base64: await fileToBase64(file), name: file.name }
    }

    const handleSuggest = async () => {
        const parts = await getFileParts()
        if (!parts) { setError('Please select a MIDI file.'); return }
        setSuggesting(true); setError('')
        try {
            const suggested: Record<string, number> = await api.post('/suggest-params',
                new URLSearchParams({ midi_base64: parts.base64, midi_name: parts.name })
            )
            setValues(prev => ({ ...prev, ...suggested }))
        } catch (e: any) {
            setError(e.message)
        } finally {
            setSuggesting(false)
        }
    }

    const handleSubmit = async () => {
        const parts = await getFileParts()
        if (!parts) { setError('Please select a MIDI file.'); return }
        setSubmitting(true); setError(''); setGp5Buffer(null)
        try {
            const params = new URLSearchParams({ midi_base64: parts.base64, midi_name: parts.name })
            Object.entries(values).forEach(([k, v]) => params.append(k, String(v)))
            const buffer: ArrayBuffer = await api.request('POST', '/tabify', params, true)

            setGp5Name(parts.name.replace(/\.midi?$/i, '.gp5'))
            setGp5Buffer(buffer)
        } catch (e: any) {
            setError(e.message)
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div className="page">
            <div className="card file-zone">
                <label className="btn" style={{ cursor: 'pointer' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                        <polyline points="17 8 12 3 7 8"/>
                        <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    Choose MIDI file
                    <input type="file" accept=".mid,.midi" onChange={e => setFile(e.target.files?.[0] ?? null)} style={{ display: 'none' }} />
                </label>
                {file && <span className="file-name">{file.name}</span>}
                <button className="btn" onClick={handleSuggest} disabled={suggesting || !file} style={{ marginLeft: 'auto' }}>
                    {suggesting && <span className="btn-spinner" />}
                    {suggesting ? 'Suggesting…' : 'Suggest parameters'}
                </button>
            </div>

            {PARAM_GROUPS.map(group => (
                <div key={group.title} className="card param-group">
                    <div className="param-group-title">{group.title}</div>
                    <div className="param-grid">
                        {group.params.map(p => (
                            <div key={p.key} className="param-field" title={p.description}>
                                <span className="param-label">{p.label}</span>
                                <input
                                    className="param-input"
                                    type="number"
                                    step="any"
                                    value={values[p.key]}
                                    onChange={e => setParam(p.key, parseFloat(e.target.value))}
                                />
                            </div>
                        ))}
                    </div>
                </div>
            ))}

            <div className="submit-row">
                {error && <span className="input-error">{error}</span>}
                <button
                    className="btn btn-primary"
                    onClick={handleSubmit}
                    disabled={submitting || !file}
                    style={{ marginLeft: error ? 0 : 'auto' }}
                >
                    {submitting && <span className="btn-spinner btn-spinner-white" />}
                    {submitting ? 'Generating…' : 'Générer la tablature'}
                </button>
            </div>

            {gp5Buffer && (
                <AlphaTabModal
                    key={gp5Buffer.byteLength}
                    gp5Buffer={gp5Buffer}
                    fileName={gp5Name}
                    onClose={() => setGp5Buffer(null)}
                />
            )}
        </div>
    )
}
