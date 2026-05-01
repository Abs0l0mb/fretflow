import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import Navigation from './components/Navigation'
import Login from './pages/Login'
import Fretflow from './pages/Fretflow'
import Account from './pages/Account'
import Me from './pages/Me'

export default function App() {
    const { user, loading } = useAuth()
    const location = useLocation()

    if (loading) return <div className="app-loading" />

    if (!user) return <Login />

    return (
        <div id="app">
            <Navigation />
            <div className="content-root">
                <div className="page-transition" key={location.pathname}>
                    <Routes location={location}>
                        <Route path="/"        element={<Fretflow />} />
                        <Route path="/account" element={<Account />} />
                        <Route path="/me"      element={<Me />} />
                        <Route path="*"        element={<Navigate to="/" replace />} />
                    </Routes>
                </div>
            </div>
        </div>
    )
}
