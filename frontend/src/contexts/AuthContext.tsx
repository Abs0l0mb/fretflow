import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { api } from '../api'

export interface User {
    id?: number
    email: string
    name?: string
    picture?: string
    [key: string]: any
}

interface AuthContextValue {
    user: User | null
    loading: boolean
    checkAuth: () => Promise<void>
    logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>(null!)

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null)
    const [loading, setLoading] = useState(true)

    const checkAuth = async () => {
        try {
            const data = await api.get('/me')
            setUser(data.content)
        } catch {
            setUser(null)
        } finally {
            setLoading(false)
        }
    }

    const logout = async () => {
        try { await api.post('/auth/logout') } catch {}
        await checkAuth()
    }

    useEffect(() => { checkAuth() }, [])

    return (
        <AuthContext.Provider value={{ user, loading, checkAuth, logout }}>
            {children}
        </AuthContext.Provider>
    )
}

export function useAuth() {
    return useContext(AuthContext)
}
