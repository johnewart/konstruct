/**
 * Optional settings panel for the example plugin.
 * Props: pluginId, projectId, settings, onSave(settings)
 * ESM so Vite can bundle it for the browser (no require).
 */
import React from 'react';

export default function PluginSettings({ pluginId, projectId, settings, onSave }) {
  const [value, setValue] = React.useState(settings.message ?? '');
  const [saved, setSaved] = React.useState(false);

  const handleSave = () => {
    onSave({ ...settings, message: value });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return React.createElement(
    'div',
    { style: { padding: 8 } },
    React.createElement('label', { key: 'l', style: { display: 'block', marginBottom: 8 } }, 'Example message (per workspace):'),
    React.createElement('input', {
      key: 'i',
      type: 'text',
      value: value,
      onChange: (e) => setValue(e.target.value),
      style: { width: '100%', maxWidth: 320, padding: '6px 8px', marginBottom: 8 },
    }),
    React.createElement(
      'button',
      { key: 'b', type: 'button', onClick: handleSave, style: { padding: '6px 12px' } },
      saved ? 'Saved' : 'Save'
    )
  );
}
