import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import Navigation from './components/Navigation'
import Login from './pages/Login'
import Tabify from './pages/Tabify'
import Account from './pages/Account'
import Me from './pages/Me'

export default function App() {
    const { user, loading } = useAuth()

    if (loading) return <div className="app-loading" />

    if (!user) return <Login />

    return (
        <div id="app">
            <Navigation />
            <div className="content-root">
                <Routes>
                    <Route path="/"        element={<Tabify />} />
                    <Route path="/account" element={<Account />} />
                    <Route path="/me"      element={<Me />} />
                    <Route path="*"        element={<Navigate to="/" replace />} />
                </Routes>
            </div>
        </div>
    )
}
