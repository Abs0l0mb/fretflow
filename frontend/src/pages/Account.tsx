import { useAuth } from '../contexts/AuthContext'

export default function Account() {
    const { user } = useAuth()

    return (
        <div className="page">
            <div className="card account-user-card">
                {user?.picture && (
                    <img src={user.picture} referrerPolicy="no-referrer" className="account-avatar" alt="" />
                )}
                <div>
                    <div className="account-name">{user?.name || '—'}</div>
                    <div className="account-email">{user?.email || '—'}</div>
                </div>
            </div>

            <div className="card account-sub-card">
                <div className="section-title">Subscription</div>
                <p className="account-sub-text">Free tier — subscription management coming soon.</p>
            </div>
        </div>
    )
}
