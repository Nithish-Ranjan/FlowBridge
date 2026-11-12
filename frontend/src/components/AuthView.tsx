import { useState } from 'react';
import { api, setStoredSessionToken } from '../api/client';
import { translations, type LanguageCode } from '../i18n/translations';

interface AuthViewProps {
  onSuccess: (user: any) => void;
  language: LanguageCode;
  onLanguageChange: (lang: LanguageCode) => void;
}

export function AuthView({ onSuccess, language, onLanguageChange }: AuthViewProps) {
  const t = translations[language];
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('owner@flowbridge.local');
  const [password, setPassword] = useState('FlowBridge123!');
  const [fullName, setFullName] = useState('Demo Distributor Owner');
  const [businessName, setBusinessName] = useState('Deccan FMCG Distributors');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleDemoLogin() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.demoLogin();
      setStoredSessionToken(res.token);
      onSuccess(res.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (isRegister) {
        const res = await api.register({
          email,
          password,
          fullName,
          businessName,
          languagePreference: language,
        });
        setStoredSessionToken(res.token);
        onSuccess(res.user);
      } else {
        const res = await api.login({ email, password });
        setStoredSessionToken(res.token);
        onSuccess(res.user);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--bg)',
        padding: 20,
      }}
    >
      <div
        className="card"
        style={{
          maxWidth: 440,
          width: '100%',
          boxShadow: '0 20px 25px -5px rgba(0,0,0,0.5)',
          padding: 28,
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <h1 style={{ margin: '0 0 6px', fontSize: '1.8rem', color: 'var(--primary)' }}>
            {t.appName}
          </h1>
          <p className="muted" style={{ margin: 0, fontSize: '0.88rem' }}>
            {t.tagline}
          </p>
        </div>

        {/* Language selector in auth */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 16 }}>
          {(['en', 'kn', 'hi'] as LanguageCode[]).map((code) => (
            <button
              key={code}
              type="button"
              className={`btn btn-sm ${language === code ? 'btn-primary' : ''}`}
              onClick={() => onLanguageChange(code)}
            >
              {code === 'en' ? 'English' : code === 'kn' ? 'ಕನ್ನಡ' : 'हिन्दी'}
            </button>
          ))}
        </div>

        {error && (
          <div className="banner banner-error" style={{ marginBottom: 14 }}>
            <div>{error}</div>
            <button className="btn btn-sm" onClick={() => setError(null)}>✕</button>
          </div>
        )}

        {/* 1-Click Demo Shortcut */}
        <div style={{ marginBottom: 18 }}>
          <button
            type="button"
            className="btn btn-emerald"
            style={{ width: '100%', padding: '10px 0', fontSize: '0.95rem' }}
            disabled={busy}
            onClick={handleDemoLogin}
          >
            ⚡ {t.demoLogin}
          </button>
          <div className="muted" style={{ textAlign: 'center', fontSize: '0.78rem', marginTop: 4 }}>
            Instantly enters Deccan FMCG Distributors seeded demo workspace
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', margin: '14px 0' }}>
          <div style={{ flex: 1, height: 1, backgroundColor: 'var(--border)' }} />
          <span className="muted" style={{ margin: '0 10px', fontSize: '0.78rem' }}>OR SIGN IN</span>
          <div style={{ flex: 1, height: 1, backgroundColor: 'var(--border)' }} />
        </div>

        <form onSubmit={handleSubmit}>
          {isRegister && (
            <>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>{t.fullName}</label>
                <input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
              </div>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>{t.businessName}</label>
                <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} required />
              </div>
            </>
          )}

          <div className="field" style={{ marginBottom: 10 }}>
            <label>{t.email}</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="field" style={{ marginBottom: 16 }}>
            <label>{t.password}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', padding: '9px 0', fontSize: '0.95rem' }}
            disabled={busy}
          >
            {isRegister ? t.register : t.login}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 14 }}>
          <button
            type="button"
            className="btn"
            style={{ fontSize: '0.82rem', background: 'transparent', border: 'none', color: 'var(--primary)' }}
            onClick={() => {
              setIsRegister(!isRegister);
              setError(null);
            }}
          >
            {isRegister ? 'Already have an account? Log In' : "Don't have an account? Register Now"}
          </button>
        </div>
      </div>
    </div>
  );
}

