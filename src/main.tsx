import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { HashRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './providers/AuthProvider'
import { ToastProvider } from './components/ui/Toast'
import { NotConfiguredPage } from './pages/NotConfiguredPage'
import { supabaseConfigured } from './lib/supabase'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // Never retry a permission or business-rule refusal - it will not
        // succeed the second time and the user is left staring at a spinner.
        const code = (error as { code?: string })?.code
        if (code && ['42501', 'P0001', 'P0002', 'PGRST301'].includes(code)) return false
        return failureCount < 2
      },
      refetchOnWindowFocus: false,
    },
  },
})

const root = createRoot(document.getElementById('root')!)

// Short-circuit before AuthProvider mounts: with placeholder credentials every
// request would fail and the user would see a spinner that never resolves.
if (!supabaseConfigured) {
  root.render(
    <StrictMode>
      <NotConfiguredPage />
    </StrictMode>,
  )
} else {
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthProvider>
            <HashRouter>
              <App />
            </HashRouter>
          </AuthProvider>
        </ToastProvider>
      </QueryClientProvider>
    </StrictMode>,
  )
}
