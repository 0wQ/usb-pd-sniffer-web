import { createRoot } from 'react-dom/client'
import './main.css'
import App from './App.tsx'

const rootElement = document.getElementById('root')

if (rootElement === null) {
  throw new Error('Root element #root was not found')
}

createRoot(rootElement).render(<App />)
