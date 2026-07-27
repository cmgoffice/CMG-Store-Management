import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './context/AuthContext';
import { InventoryProvider } from './context/InventoryContext';
import { RoleProvider } from './context/RoleContext';
import { DialogProvider } from './context/DialogContext';
import { LanguageProvider } from './context/LanguageContext';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <InventoryProvider>
          <RoleProvider>
            <LanguageProvider><DialogProvider><App /></DialogProvider></LanguageProvider>
          </RoleProvider>
        </InventoryProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
