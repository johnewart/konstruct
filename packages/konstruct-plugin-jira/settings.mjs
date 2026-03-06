/**
 * Settings panel for the JIRA plugin.
 * Props: pluginId, projectId, settings, onSave(settings)
 *
 * ESM so Vite can bundle it for the browser — no require() calls.
 * Uses React.createElement (no JSX) to avoid needing a build step.
 */
import React from 'react';

export default function JiraPluginSettings({ pluginId, projectId, settings, onSave }) {
  const [baseUrl, setBaseUrl] = React.useState(settings.baseUrl ?? '');
  const [email, setEmail] = React.useState(settings.email ?? '');
  const [apiToken, setApiToken] = React.useState(settings.apiToken ?? '');
  const [saved, setSaved] = React.useState(false);

  const handleSave = () => {
    onSave({ ...settings, baseUrl, email, apiToken });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const fieldStyle = { display: 'block', marginBottom: 4 };
  const inputStyle = { width: '100%', maxWidth: 360, padding: '6px 8px', marginBottom: 12 };
  const labelStyle = { display: 'block', marginBottom: 4, fontWeight: 500 };

  return React.createElement(
    'div',
    { style: { padding: 8 } },

    // JIRA Base URL
    React.createElement('label', { key: 'l-url', style: labelStyle }, 'JIRA Base URL'),
    React.createElement('input', {
      key: 'i-url',
      type: 'text',
      placeholder: 'https://your-org.atlassian.net',
      value: baseUrl,
      onChange: (e) => setBaseUrl(e.target.value),
      style: inputStyle,
    }),

    // Email
    React.createElement('label', { key: 'l-email', style: labelStyle }, 'Email'),
    React.createElement('input', {
      key: 'i-email',
      type: 'text',
      placeholder: 'you@example.com',
      value: email,
      onChange: (e) => setEmail(e.target.value),
      style: inputStyle,
    }),

    // API Token
    React.createElement('label', { key: 'l-token', style: labelStyle }, 'API Token'),
    React.createElement('input', {
      key: 'i-token',
      type: 'password',
      placeholder: 'Your Atlassian API token',
      value: apiToken,
      onChange: (e) => setApiToken(e.target.value),
      style: inputStyle,
    }),

    // Save button
    React.createElement(
      'button',
      {
        key: 'btn',
        type: 'button',
        onClick: handleSave,
        style: { padding: '6px 16px' },
      },
      saved ? 'Saved!' : 'Save',
    ),
  );
}
