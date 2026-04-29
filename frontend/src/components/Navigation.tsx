import { useState, useRef, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function Navigation() {
    const { user, logout } = useAuth()
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

    return (
        <nav className="nav">
            <span className="nav-logo" onClick={() => navigate('/')}>FretFlow</span>

            <div className="nav-links">
                <button
                    className={`nav-link${location.pathname === '/' ? ' active' : ''}`}
                    onClick={() => navigate('/')}
                >
                    MIDI to tabs
                </button>
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
                                My account
                            </div>
                            <div className="nav-dropdown-item danger" onClick={() => { logout(); setUserMenuOpen(false) }}>
                                Log out
                            </div>
                        </div>
                    )}
                </div>
            )}
        </nav>
    )
}
