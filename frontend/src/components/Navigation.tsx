import { useState, useRef, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'
import i18n from '../i18n'

const LANGS = [
    { code: 'en', label: 'EN' },
    { code: 'fr', label: 'FR' },
]

export default function Navigation() {
    const { user, logout } = useAuth()
    const { t } = useTranslation()
    const navigate = useNavigate()
    const location = useLocation()
    const [userMenuOpen, setUserMenuOpen] = useState(false)
    const userMenuRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node))
                setUserMenuOpen(false)
        }
        document.addEventListener('mousedown', handleClick)
        return () => document.removeEventListener('mousedown', handleClick)
    }, [])

    const switchLang = (code: string) => {
        i18n.changeLanguage(code)
        localStorage.setItem('lang', code)
    }

    return (
        <nav className="nav">
            <span className="nav-logo" onClick={() => navigate('/')}>{t('nav.logo')}</span>

            <div className="nav-links">
                <button
                    className={`nav-link${location.pathname === '/app' ? ' active' : ''}`}
                    onClick={() => navigate('/app')}
                >
                    {t('nav.midi_to_tabs')}
                </button>
            </div>

            <div className="nav-lang">
                {LANGS.map(l => (
                    <button
                        key={l.code}
                        className={`nav-lang-btn${i18n.language === l.code ? ' active' : ''}`}
                        onClick={() => switchLang(l.code)}
                    >
                        {l.label}
                    </button>
                ))}
            </div>

            {user && (
                <div className="nav-user" ref={userMenuRef} onClick={() => setUserMenuOpen(o => !o)}>
                    {user.picture && (
                        <img src={user.picture} referrerPolicy="no-referrer" className="nav-user-avatar" alt="" />
                    )}
                    <span className="nav-user-name">{user.name || user.email}</span>

                    {userMenuOpen && (
                        <div className="nav-dropdown">
                            <div className="nav-dropdown-item" onClick={() => { navigate('/account'); setUserMenuOpen(false) }}>
                                {t('nav.my_account')}
                            </div>
                            <div className="nav-dropdown-item danger" onClick={() => { logout(); navigate('/'); setUserMenuOpen(false) }}>
                                {t('nav.log_out')}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </nav>
    )
}
