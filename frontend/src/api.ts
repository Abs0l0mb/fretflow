const BASE = '/api'

async function request(method: string, endpoint: string, body?: any, binary = false): Promise<any> {
    const options: RequestInit = {
        method,
        credentials: 'include',
    }

    if (body !== undefined) {
        if (body instanceof FormData || body instanceof URLSearchParams) {
            options.body = body
        } else {
            options.headers = { 'Content-Type': 'application/json' }
            options.body = JSON.stringify(body)
        }
    }

    const res = await fetch(BASE + endpoint, options)

    if (!res.ok) {
        let msg = res.statusText
        try { const j = await res.json(); msg = j.content || j.error || msg } catch {}
        throw new Error(msg)
    }

    if (binary) return res.arrayBuffer()
    return res.json()
}

export const api = {
    get:     (endpoint: string)                          => request('GET', endpoint),
    post:    (endpoint: string, body?: any)              => request('POST', endpoint, body),
    request: (method: string, endpoint: string, body?: any, binary = false) => request(method, endpoint, body, binary),
}
