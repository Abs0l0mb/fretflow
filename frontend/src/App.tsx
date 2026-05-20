import { Routes, Route, Navigate, useLocation, Outlet } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import Navigation from './components/Navigation'
import Landing from './pages/Landing'
import Fretflow from './pages/Fretflow'
import Account from './pages/Account'
import Me from './pages/Me'

function AppLayout() {
    const location = useLocation()
    return (
        <div id="app">
            <Navigation />
            <div className="content-root">
                <div className="page-transition" key={location.pathname}>
                    <Outlet />
                </div>
            </div>
        </div>
    )
}

export default function App() {
    const { user, loading } = useAuth()

    if (loading) return <div className="app-loading" />

    return (
        <Routes>
            <Route path="/" element={<Landing />} />
            {user ? (
                <Route element={<AppLayout />}>
                    <Route path="/app"     element={<Fretflow />} />
                    <Route path="/account" element={<Account />} />
                    <Route path="/me"      element={<Me />} />
                    <Route path="*"        element={<Navigate to="/app" replace />} />
                </Route>
            ) : (
                <Route path="*" element={<Navigate to="/" replace />} />
            )}
        </Routes>
    )
}
