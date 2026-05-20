import { useState } from 'react'
import Login from './Login'

const FEATURES = [
    {
        icon: '🎸',
        title: 'MIDI to Guitar Pro tabs',
        desc: 'Upload any MIDI file and get a .gp5 tab ready to open in Guitar Pro or TuxGuitar.',
        badge: 'Available now',
    },
    {
        icon: '⚙️',
        title: 'Smart conversion presets',
        desc: 'Choose from presets tuned for electric, acoustic, fingerpicking, blues, and more.',
        badge: 'Available now',
    },
    {
        icon: '✨',
        title: 'A full suite of tools',
        desc: 'Lick & riff generator, chord voicing suggester, difficulty analyzer, tuning converter — and more on the way.',
        badge: 'Coming soon',
    },
]

export default function Landing() {
    const [showLogin, setShowLogin] = useState(false)

    if (showLogin) return <Login />

    return (
        <div className="landing">
            <nav className="landing-nav">
                <span className="landing-nav-logo">♪ FretFlow</span>
                <button className="btn btn-primary" onClick={() => setShowLogin(true)}>Sign in</button>
            </nav>

            <section className="landing-hero">
                <div className="landing-hero-inner">
                    <div className="landing-badge">Beta</div>
                    <h1 className="landing-title">Turn MIDI files into<br />Guitar Pro tabs</h1>
                    <p className="landing-sub">Upload a MIDI, get a <code>.gp5</code> tab instantly. Built for composers and guitarists who want to see their ideas on paper.</p>
                    <button className="btn btn-primary landing-cta" onClick={() => setShowLogin(true)}>
                        Get started — it's free
                    </button>
                </div>
            </section>

            <section className="landing-features">
                {FEATURES.map(f => (
                    <div key={f.title} className="landing-feature-card">
                        <div className="landing-feature-icon">{f.icon}</div>
                        <div className={`landing-feature-badge${f.badge === 'Coming soon' ? ' landing-feature-badge--soon' : ''}`}>{f.badge}</div>
                        <h3 className="landing-feature-title">{f.title}</h3>
                        <p className="landing-feature-desc">{f.desc}</p>
                    </div>
                ))}
            </section>

            <footer className="landing-footer">
                FretFlow &copy; {new Date().getFullYear()}
            </footer>
        </div>
    )
}
