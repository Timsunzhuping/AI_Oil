import { createBrowserRouter } from 'react-router-dom';
import App from './App';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    errorElement: <div>404 - Page not found</div>,
  },
  {
    path: '/projects',
    lazy: () => import('./pages/projects').then(m => ({ Component: m.ProjectsPage })),
  },
  {
    path: '/formulas',
    lazy: () => import('./pages/formulas').then(m => ({ Component: m.FormulasPage })),
  },
]);
