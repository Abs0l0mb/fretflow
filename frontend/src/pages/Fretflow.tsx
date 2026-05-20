import { useState, useRef, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import * as at from '@coderline/alphatab'
import { api } from '../api'

const PLAYER_ENABLED = false

// ── Tuning ─────────────────────────────────────────────────────────

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
function midiToNote(pitch: number): string {
    return NOTE_NAMES[pitch % 12] + (Math.floor(pitch / 12) - 1)
}
function noteToMidi(note: string): number | null {
    const m = note.trim().match(/^([A-Ga-g]#?b?)(-?\d+)$/)
    if (!m) return null
    const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
    const flat: Record<string,string> = { Cb:'B', Db:'C#', Eb:'D#', Fb:'E', Gb:'F#', Ab:'G#', Bb:'A#' }
    const name = flat[m[1]] ?? m[1].charAt(0).toUpperCase() + m[1].slice(1)
    const idx = names.indexOf(name)
    if (idx === -1) return null
    return (parseInt(m[2]) + 1) * 12 + idx
}

interface TuningPreset { key: string; labelKey: string; pitches: number[] }
const TUNING_PRESETS: TuningPreset[] = [
    { key: 'e_std',   labelKey: 'fretflow.tuning_e_std',   pitches: [64,59,55,50,45,40] },
    { key: 'eb_std',  labelKey: 'fretflow.tuning_eb_std',  pitches: [63,58,54,49,44,39] },
    { key: 'd_std',   labelKey: 'fretflow.tuning_d_std',   pitches: [62,57,53,48,43,38] },
    { key: 'drop_d',  labelKey: 'fretflow.tuning_drop_d',  pitches: [64,59,55,50,45,38] },
    { key: 'drop_c',  labelKey: 'fretflow.tuning_drop_c',  pitches: [62,57,53,48,43,36] },
    { key: 'dadgad',  labelKey: 'fretflow.tuning_dadgad',  pitches: [62,57,55,50,45,38] },
    { key: 'open_g',  labelKey: 'fretflow.tuning_open_g',  pitches: [62,59,55,50,47,38] },
    { key: 'seven',   labelKey: 'fretflow.tuning_seven',   pitches: [64,59,55,50,45,40,35] },
]
const DEFAULT_TUNING = TUNING_PRESETS[0].pitches

// ── Parameter definitions (keys reference i18n) ────────────────────

interface ParamDef { key: string; labelKey: string; defaultValue: number; descriptionKey?: string }
interface ParamGroup { titleKey: string; params: ParamDef[] }

const PARAM_GROUPS: ParamGroup[] = [
    { titleKey: 'fretflow.group_general', params: [
        { key: 'step',  labelKey: 'fretflow.param_step',  defaultValue: 60  },
        { key: 'gpq',   labelKey: 'fretflow.param_gpq',   defaultValue: 960 },
        { key: 'tempo', labelKey: 'fretflow.param_tempo',  defaultValue: 120 },
    ]},
    { titleKey: 'fretflow.group_search', params: [
        { key: 'max_fret',    labelKey: 'fretflow.param_max_fret',    defaultValue: 20  },
        { key: 'per_pitch_k', labelKey: 'fretflow.param_per_pitch_k', defaultValue: 4   },
        { key: 'chord_k',     labelKey: 'fretflow.param_chord_k',     defaultValue: 50  },
        { key: 'beam_size',   labelKey: 'fretflow.param_beam_size',   defaultValue: 100 },
    ]},
    { titleKey: 'fretflow.group_local_cost', params: [
        { key: 'w_span',                labelKey: 'fretflow.param_w_span',                defaultValue: 1.0  },
        { key: 'w_high',                labelKey: 'fretflow.param_w_high',                defaultValue: 0.2  },
        { key: 'high_fret_threshold',   labelKey: 'fretflow.param_high_fret_threshold',   defaultValue: 19   },
        { key: 'w_open_bonus',          labelKey: 'fretflow.param_w_open_bonus',          defaultValue: 0    },
        { key: 'w_string_range',        labelKey: 'fretflow.param_w_string_range',        defaultValue: 0.15 },
        { key: 'preferred_min_fret',    labelKey: 'fretflow.param_preferred_min_fret',    defaultValue: 5    },
        { key: 'preferred_max_fret',    labelKey: 'fretflow.param_preferred_max_fret',    defaultValue: 17   },
        { key: 'w_preferred_zone',      labelKey: 'fretflow.param_w_preferred_zone',      defaultValue: -1.5 },
        { key: 'high_string_threshold', labelKey: 'fretflow.param_high_string_threshold', defaultValue: 2    },
        { key: 'w_high_string',         labelKey: 'fretflow.param_w_high_string',         defaultValue: 2.0  },
    ]},
    { titleKey: 'fretflow.group_chords', params: [
        { key: 'w_holes',  labelKey: 'fretflow.param_w_holes',  defaultValue: 4   },
        { key: 'w_gap',    labelKey: 'fretflow.param_w_gap',    defaultValue: 0.6 },
        { key: 'w_blocks', labelKey: 'fretflow.param_w_blocks', defaultValue: 4   },
    ]},
    { titleKey: 'fretflow.group_same_string', params: [
        { key: 'same_string_pitch_threshold', labelKey: 'fretflow.param_same_string_pitch_threshold', defaultValue: 5    },
        { key: 'w_same_string_bonus',         labelKey: 'fretflow.param_w_same_string_bonus',         defaultValue: -1.0 },
    ]},
    { titleKey: 'fretflow.group_string_jump', params: [
        { key: 'string_jump_threshold', labelKey: 'fretflow.param_string_jump_threshold', defaultValue: 1   },
        { key: 'w_string_jump',         labelKey: 'fretflow.param_w_string_jump',         defaultValue: 1.5 },
    ]},
    { titleKey: 'fretflow.group_legato', params: [
        { key: 'allow_legato',      labelKey: 'fretflow.param_allow_legato',      defaultValue: 0   },
        { key: 'max_fret_distance', labelKey: 'fretflow.param_max_fret_distance', defaultValue: 5   },
        { key: 'speed_threshold',   labelKey: 'fretflow.param_speed_threshold',   defaultValue: 480 },
    ]},
    { titleKey: 'fretflow.group_tapping', params: [
        { key: 'allow_tapping',      labelKey: 'fretflow.param_allow_tapping',      defaultValue: 0   },
        { key: 'tap_min_fret',       labelKey: 'fretflow.param_tap_min_fret',       defaultValue: 7   },
        { key: 'w_tap_activation',   labelKey: 'fretflow.param_w_tap_activation',   defaultValue: 2.0 },
        { key: 'w_tap_deactivation', labelKey: 'fretflow.param_w_tap_deactivation', defaultValue: 0.5 },
        { key: 'w_tap_jump',         labelKey: 'fretflow.param_w_tap_jump',         defaultValue: 1.0 },
    ]},
    { titleKey: 'fretflow.group_transition', params: [
        { key: 'w_jump',                 labelKey: 'fretflow.param_w_jump',                 defaultValue: 0.8  },
        { key: 'jump_power',             labelKey: 'fretflow.param_jump_power',             defaultValue: 1.2  },
        { key: 'jump_threshold',         labelKey: 'fretflow.param_jump_threshold',         defaultValue: 5    },
        { key: 'jump_threshold_penalty', labelKey: 'fretflow.param_jump_threshold_penalty', defaultValue: 3.0  },
        { key: 'w_avg_jump',             labelKey: 'fretflow.param_w_avg_jump',             defaultValue: 0.6  },
        { key: 'avg_jump_power',         labelKey: 'fretflow.param_avg_jump_power',         defaultValue: 1.3  },
        { key: 'w_span_change',          labelKey: 'fretflow.param_w_span_change',          defaultValue: 0.25 },
        { key: 'w_string_center',        labelKey: 'fretflow.param_w_string_center',        defaultValue: 3    },
        { key: 'close_jump_threshold',   labelKey: 'fretflow.param_close_jump_threshold',   defaultValue: 4.0  },
        { key: 'close_jump_bonus',       labelKey: 'fretflow.param_close_jump_bonus',       defaultValue: -1.2 },
        { key: 'rest_enter_penalty',     labelKey: 'fretflow.param_rest_enter_penalty',     defaultValue: 0.0  },
        { key: 'rest_exit_penalty',      labelKey: 'fretflow.param_rest_exit_penalty',      defaultValue: 0.0  },
        { key: 'w_streak',               labelKey: 'fretflow.param_w_streak',               defaultValue: 4.0  },
        { key: 'streak_min_len',         labelKey: 'fretflow.param_streak_min_len',         defaultValue: 4    },
        { key: 'streak_speed_threshold', labelKey: 'fretflow.param_streak_speed_threshold', defaultValue: 480  },
    ]},
]

function buildDefaults(): Record<string, number> {
    const v: Record<string, number> = {}
    for (const g of PARAM_GROUPS) for (const p of g.params) v[p.key] = p.defaultValue
    return v
}

// ── Presets ────────────────────────────────────────────────────────

type PresetKey = 'default' | 'electric' | 'lead' | 'acoustic' | 'fingerpicking' | 'blues'

const PRESET_OVERRIDES: Record<PresetKey, Partial<Record<string, number>>> = {
    default: {},
    electric: {
        allow_legato: 0, allow_tapping: 0,
        w_open_bonus: 0,
        preferred_min_fret: 5, preferred_max_fret: 17,
        w_same_string_bonus: -0.5,
    },
    lead: {
        // Deep ground-truth search: 3000 TPE + 500 CMA-ES trials, beam=100 (65.5% exact string accuracy)
        allow_legato: 1,              allow_tapping: 1,
        tap_min_fret: 7,              w_tap_activation: 2.37,
        w_tap_deactivation: 0.44,     w_tap_jump: 2.61,
        max_fret_distance: 6.27,      speed_threshold: 666,
        w_span: 17.76,                w_high: 6.74,
        w_string_range: 3.28,         w_preferred_zone: -7.47,
        w_high_string: 12.76,         w_open_bonus: 3.75,
        high_fret_threshold: 13,      preferred_min_fret: 4,
        preferred_max_fret: 13,       high_string_threshold: 1,
        w_holes: 10.60,               w_gap: 2.83,    w_blocks: 12.37,
        w_jump: 0.28,                 jump_power: 1.10,
        jump_threshold: 3,            jump_threshold_penalty: 8.46,
        w_avg_jump: 0.12,             avg_jump_power: 1.06,
        w_string_center: 0.09,        close_jump_threshold: 5.92,
        close_jump_bonus: -4.58,      w_span_change: 4.82,
        w_streak: 4.60,               streak_min_len: 3,
        streak_speed_threshold: 608,
        rest_enter_penalty: 1.96,     rest_exit_penalty: 1.23,
        w_same_string_bonus: -4.90,   same_string_pitch_threshold: 2,
        w_string_jump: 10.05,         string_jump_threshold: 3,
    },
    acoustic: {
        max_fret: 15,
        allow_legato: 0, allow_tapping: 0,
        w_open_bonus: -3.0,
        preferred_min_fret: 0, preferred_max_fret: 12,
        w_preferred_zone: -2.0,
        w_high_string: 0.5,
        w_same_string_bonus: 0,
    },
    fingerpicking: {
        max_fret: 15,
        allow_legato: 0, allow_tapping: 0,
        w_open_bonus: -2.5,
        preferred_min_fret: 0, preferred_max_fret: 12,
        w_preferred_zone: -2.0,
        w_same_string_bonus: -1.5, same_string_pitch_threshold: 5,
        w_string_jump: 0.8,
        w_high_string: 0.5,
    },
    blues: {
        allow_legato: 1, allow_tapping: 0,
        speed_threshold: 360,
        w_same_string_bonus: -1.5, same_string_pitch_threshold: 6,
        preferred_min_fret: 5, preferred_max_fret: 15,
        w_open_bonus: -1.0,
    },
}

function applyPreset(key: PresetKey): Record<string, number> {
    const merged = { ...buildDefaults(), ...PRESET_OVERRIDES[key] }
    return Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined)) as Record<string, number>
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
    const { t } = useTranslation()
    const containerRef = useRef<HTMLDivElement>(null)
    const apiRef = useRef<at.AlphaTabApi | null>(null)
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
    const [errorMsg, setErrorMsg] = useState('')
    const [playing, setPlaying] = useState(false)

    useEffect(() => {
        if (!PLAYER_ENABLED || !containerRef.current) return

        const api = new at.AlphaTabApi(containerRef.current, {
            core: { fontDirectory: '/font/', scriptFile: '/alphaTab.min.js' },
            player: { enablePlayer: true, enableCursor: true, soundFont: '/soundfont/sonivox.sf2' },
            display: { scale: 1.0 },
        })

        api.playerStateChanged.on((e: any) => setPlaying(e.state === at.synth.PlayerState.Playing))
        api.scoreLoaded.on(() => setStatus('ready'))
        api.error.on((e: any) => { setStatus('error'); setErrorMsg(e.message ?? String(e)) })
        api.load(new Uint8Array(gp5Buffer))
        apiRef.current = api

        return () => { api.destroy(); apiRef.current = null }
    }, [gp5Buffer])

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
                        {PLAYER_ENABLED && <>
                            <button className="btn btn-primary" onClick={() => apiRef.current?.playPause()} disabled={status !== 'ready'}>
                                {playing ? t('fretflow.pause') : t('fretflow.play')}
                            </button>
                            <button className="btn" onClick={() => apiRef.current?.stop()} disabled={status !== 'ready'}>
                                {t('fretflow.stop')}
                            </button>
                        </>}
                        <button className="btn" onClick={handleDownload}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                                <polyline points="7 10 12 15 17 10"/>
                                <line x1="12" y1="3" x2="12" y2="15"/>
                            </svg>
                            {t('fretflow.download')}
                        </button>
                        {PLAYER_ENABLED && status === 'loading' && (
                            <span className="player-status">
                                <span className="btn-spinner" style={{ display: 'inline-block' }} /> {t('fretflow.loading_score')}
                            </span>
                        )}
                        {PLAYER_ENABLED && status === 'error' && (
                            <span className="player-status player-status-error">Error: {errorMsg}</span>
                        )}
                    </div>
                    <button className="btn player-modal-close" onClick={onClose} title="Close (Esc)">✕</button>
                </div>
                {PLAYER_ENABLED
                    ? <div ref={containerRef} className="alphatab-container" />
                    : <div className="alphatab-container player-coming-soon">
                        <p>Tab player coming in a future update.</p>
                        <p className="player-coming-soon-sub">The library costs €500 — if you'd like to help make it happen, consider supporting the project! In the meantime, download your tab with the button above and open it in Guitar Pro or TuxGuitar.</p>
                    </div>
                }
            </div>
        </div>
    )
}

// ── Tuning selector ────────────────────────────────────────────────

function TuningSelector({ tuning, tuningKey, onChange }: {
    tuning: number[]
    tuningKey: string
    onChange: (key: string, pitches: number[]) => void
}) {
    const { t } = useTranslation()
    const [customText, setCustomText] = useState(tuning.map(midiToNote).join(' '))
    const [customError, setCustomError] = useState('')

    const handlePreset = (p: TuningPreset) => {
        setCustomText(p.pitches.map(midiToNote).join(' '))
        setCustomError('')
        onChange(p.key, p.pitches)
    }

    const handleCustomChange = (raw: string) => {
        setCustomText(raw)
        const parts = raw.trim().split(/[\s,]+/)
        const pitches = parts.map(noteToMidi)
        if (pitches.some(p => p === null) || pitches.length < 4) {
            setCustomError(t('fretflow.tuning_invalid'))
            return
        }
        setCustomError('')
        onChange('custom', pitches as number[])
    }

    return (
        <div className="card tuning-card">
            <span className="preset-bar-label">{t('fretflow.tuning')}</span>
            <div className="tuning-presets">
                {TUNING_PRESETS.map(p => (
                    <button
                        key={p.key}
                        className={`tuning-btn${tuningKey === p.key ? ' active' : ''}`}
                        onClick={() => handlePreset(p)}
                    >
                        {t(p.labelKey)}
                        <span className="tuning-notes">{p.pitches.map(midiToNote).join(' ')}</span>
                    </button>
                ))}
                <button
                    className={`tuning-btn${tuningKey === 'custom' ? ' active' : ''}`}
                    onClick={() => onChange('custom', tuning)}
                >
                    {t('fretflow.tuning_custom')}
                    <span className="tuning-notes">{t('fretflow.tuning_custom_hint')}</span>
                </button>
            </div>
            {tuningKey === 'custom' && (
                <div className="tuning-custom-row">
                    <input
                        className={`input tuning-custom-input${customError ? ' input-error-border' : ''}`}
                        value={customText}
                        onChange={e => handleCustomChange(e.target.value)}
                        placeholder="E4 B3 G3 D3 A2 E2"
                        spellCheck={false}
                    />
                    {customError
                        ? <span className="tuning-error">{customError}</span>
                        : <span className="tuning-hint">{t('fretflow.tuning_custom_format')}</span>
                    }
                </div>
            )}
        </div>
    )
}

// ── Main FretFlow page ─────────────────────────────────────────────

export default function Fretflow() {
    const { t } = useTranslation()
    const [file, setFile] = useState<File | null>(null)
    const [values, setValues] = useState<Record<string, number>>(buildDefaults)
    const [activePreset, setActivePreset] = useState<PresetKey | 'custom'>('default')
    const [tuning, setTuning] = useState<number[]>(DEFAULT_TUNING)
    const [tuningKey, setTuningKey] = useState<string>('e_std')

    // Cache: last generated result + the state that produced it
    const [cached, setCached] = useState<{ buffer: ArrayBuffer; name: string } | null>(null)
    const [lastUsed, setLastUsed] = useState<{ values: string; tuning: string; fileName: string } | null>(null)
    const [suggesting, setSuggesting] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState('')
    const [gp5Buffer, setGp5Buffer] = useState<ArrayBuffer | null>(null)
    const [gp5Name, setGp5Name] = useState('')

    const setParam = useCallback((key: string, value: number) => {
        setActivePreset('custom')
        setValues(prev => ({ ...prev, [key]: value }))
    }, [])

    const handlePreset = useCallback((key: PresetKey) => {
        setActivePreset(key)
        setValues(applyPreset(key))
    }, [])

    const getFileParts = async () => {
        if (!file) return null
        return { base64: await fileToBase64(file), name: file.name }
    }

    const handleSuggest = async () => {
        const parts = await getFileParts()
        if (!parts) { setError(t('fretflow.no_file_error')); return }
        setSuggesting(true); setError('')
        try {
            const suggested: Record<string, number> = await api.post('/suggest-params',
                new URLSearchParams({ midi_base64: parts.base64, midi_name: parts.name })
            )
            setValues(prev => ({ ...prev, ...suggested }))
            setActivePreset('custom')
        } catch (e: any) {
            setError(e.message)
        } finally {
            setSuggesting(false)
        }
    }

    const currentSnapshot = () => ({
        values:   JSON.stringify(values),
        tuning:   tuning.join(','),
        fileName: file?.name ?? '',
    })

    const hasChanges = !cached || !lastUsed
        || lastUsed.values   !== JSON.stringify(values)
        || lastUsed.tuning   !== tuning.join(',')
        || lastUsed.fileName !== (file?.name ?? '')

    const handleSubmit = async () => {
        const parts = await getFileParts()
        if (!parts) { setError(t('fretflow.no_file_error')); return }
        setSubmitting(true); setError(''); setGp5Buffer(null)
        try {
            const params = new URLSearchParams({ midi_base64: parts.base64, midi_name: parts.name, tuning: tuning.join(',') })
            Object.entries(values).forEach(([k, v]) => params.append(k, String(v)))
            const buffer: ArrayBuffer = await api.request('POST', '/convert', params, true)
            const name = parts.name.replace(/\.midi?$/i, '.gp5')
            setCached({ buffer, name })
            setLastUsed(currentSnapshot())
            setGp5Name(name)
            setGp5Buffer(buffer)
        } catch (e: any) {
            setError(e.message)
        } finally {
            setSubmitting(false)
        }
    }

    const PRESETS: { key: PresetKey; labelKey: string; icon: string }[] = [
        { key: 'default',       labelKey: 'fretflow.preset_default',       icon: '🎸' },
        { key: 'electric',      labelKey: 'fretflow.preset_electric',      icon: '⚡' },
        { key: 'lead',          labelKey: 'fretflow.preset_lead',          icon: '🎯' },
        { key: 'acoustic',      labelKey: 'fretflow.preset_acoustic',      icon: '🪵' },
        { key: 'fingerpicking', labelKey: 'fretflow.preset_fingerpicking', icon: '🤌' },
        { key: 'blues',         labelKey: 'fretflow.preset_blues',         icon: '🎷' },
    ]

    return (
        <div className="page">
            <div className="card file-zone">
                <label className="btn" style={{ cursor: 'pointer' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                        <polyline points="17 8 12 3 7 8"/>
                        <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    {t('fretflow.choose_file')}
                    <input type="file" accept=".mid,.midi" onChange={e => setFile(e.target.files?.[0] ?? null)} style={{ display: 'none' }} />
                </label>
                {file && <span className="file-name">{file.name}</span>}
                <button className="btn" onClick={handleSuggest} disabled={suggesting || !file} style={{ marginLeft: 'auto' }}>
                    {suggesting && <span className="btn-spinner" />}
                    {suggesting ? t('fretflow.suggesting') : t('fretflow.suggest_params')}
                </button>
            </div>

            <TuningSelector
                tuning={tuning}
                tuningKey={tuningKey}
                onChange={(key, pitches) => { setTuningKey(key); setTuning(pitches) }}
            />

            <div className="card preset-bar">
                <span className="preset-bar-label">{t('fretflow.presets')}</span>
                <div className="preset-grid">
                    {PRESETS.map(p => (
                        <button
                            key={p.key}
                            className={`preset-btn${activePreset === p.key ? ' active' : ''}`}
                            onClick={() => handlePreset(p.key)}
                        >
                            <span className="preset-icon">{p.icon}</span>
                            {t(p.labelKey)}
                        </button>
                    ))}
                    <button
                        className={`preset-btn${activePreset === 'custom' ? ' active' : ''}`}
                        onClick={() => setActivePreset('custom')}
                    >
                        <span className="preset-icon">⚙️</span>
                        {t('fretflow.preset_custom')}
                    </button>
                </div>
            </div>

            {activePreset === 'custom' && PARAM_GROUPS.map(group => (
                <div key={group.titleKey} className="card param-group">
                    <div className="param-group-title">{t(group.titleKey)}</div>
                    <div className="param-grid">
                        {group.params.map(p => (
                            <div key={p.key} className="param-field" title={p.descriptionKey ? t(p.descriptionKey) : undefined}>
                                <span className="param-label">{t(p.labelKey)}</span>
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
                {cached && (
                    <button
                        className="btn"
                        onClick={() => setGp5Buffer(cached.buffer)}
                        style={{ marginLeft: error ? 0 : 'auto' }}
                    >
                        {t('fretflow.view_last_tab')}
                    </button>
                )}
                <button
                    className="btn btn-primary"
                    onClick={handleSubmit}
                    disabled={submitting || !file || (!hasChanges && !!cached)}
                    style={{ marginLeft: cached || error ? 0 : 'auto' }}
                    title={!hasChanges && cached ? t('fretflow.no_changes') : undefined}
                >
                    {submitting && <span className="btn-spinner btn-spinner-white" />}
                    {submitting ? t('fretflow.generating') : t('fretflow.generate')}
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
