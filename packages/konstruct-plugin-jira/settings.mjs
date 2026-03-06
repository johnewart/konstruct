/**
 * Settings panel for the JIRA plugin.
 * Lets users configure the JIRA Cloud base URL, email, and API token.
 *
 * Props: pluginId, projectId, settings, pluginConfig, onSave, onSaveConfig
 */
import React from 'react';

const inputStyle = {
  width: '100%',
  maxWidth: 400,
  padding: '6px 8px',
  marginBottom: 8,
  boxSizing: 'border-box',
};

const labelStyle = { display: 'block', marginBottom: 4, fontWeight: 500 };
const fieldStyle = { marginBottom: 16 };

export default function JiraPluginSettings({ pluginConfig = {}, onSaveConfig }) {
  const [baseUrl, setBaseUrl] = React.useState(pluginConfig.baseUrl ?? '');
  const [email, setEmail] = React.useState(pluginConfig.email ?? '');
  const [apiToken, setApiToken] = React.useState(pluginConfig.apiToken ?? '');
  const [saved, setSaved] = React.useState(false);

  const handleSave = () => {
    onSaveConfig({ ...pluginConfig, baseUrl: baseUrl.trim(), email: email.trim(), apiToken: apiToken.trim() });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return React.createElement(
    'div',
    { style: { padding: 8 } },

    React.createElement('h3', { key: 'h', style: { marginTop: 0, marginBottom: 16 } }, 'JIRA Cloud Configuration'),

    // baseUrl
    React.createElement(
      'div',
      { key: 'f1', style: fieldStyle },
      React.createElement('label', { style: labelStyle }, 'Base URL'),
      React.createElement('input', {
        type: 'url',
        placeholder: 'https://your-org.atlassian.net',
        value: baseUrl,
        onChange: (e) => setBaseUrl(e.target.value),
        style: inputStyle,
      }),
      React.createElement('small', null, 'Your Atlassian Cloud domain, e.g. https://acme.atlassian.net')
    ),

    // email
    React.createElement(
      'div',
      { key: 'f2', style: fieldStyle },
      React.createElement('label', { style: labelStyle }, 'Email'),
      React.createElement('input', {
        type: 'email',
        placeholder: 'you@example.com',
        value: email,
        onChange: (e) => setEmail(e.target.value),
        style: inputStyle,
      }),
      React.createElement('small', null, 'The email address of your Atlassian account')
    ),

    // apiToken
    React.createElement(
      'div',
      { key: 'f3', style: fieldStyle },
      React.createElement('label', { style: labelStyle }, 'API Token'),
      React.createElement('input', {
        type: 'password',
        placeholder: 'Your Atlassian API token',
        value: apiToken,
        onChange: (e) => setApiToken(e.target.value),
        style: inputStyle,
      }),
      React.createElement(
        'small',
        null,
        'Generate one at ',
        React.createElement('a', { href: 'https://id.atlassian.com/manage-profile/security/api-tokens', target: '_blank', rel: 'noreferrer' }, 'id.atlassian.com')
      )
    ),

    React.createElement(
      'button',
      { key: 'btn', type: 'button', onClick: handleSave, style: { padding: '6px 16px' } },
      saved ? '✓ Saved' : 'Save'
    )
  );
}
