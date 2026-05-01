import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'

export default function Account() {
    const { user } = useAuth()
    const { t } = useTranslation()

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
                <div className="section-title">{t('account.subscription')}</div>
                <p className="account-sub-text">{t('account.free_tier')}</p>
            </div>
        </div>
    )
}
