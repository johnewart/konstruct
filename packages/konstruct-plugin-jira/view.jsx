/**
 * JIRA plugin view — registered automatically by usePluginViews via import.meta.glob.
 * Exports: default (React component), path (string), label (string).
 */

import React, { useState, useCallback } from 'react';
import { trpc } from '../../src/client/trpc';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const path = '/jira';
export const label = 'JIRA';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_COLORS = {
  'blue-grey': '#6B778C',
  blue: '#0052CC',
  yellow: '#FF991F',
  green: '#00875A',
  red: '#DE350B',
};

function statusColor(colorName) {
  return STATUS_COLORS[colorName] ?? '#6B778C';
}

function priorityEmoji(priority) {
  if (!priority) return '';
  const p = priority.toLowerCase();
  if (p === 'highest' || p === 'critical') return '🔴';
  if (p === 'high') return '🟠';
  if (p === 'medium') return '🟡';
  if (p === 'low') return '🔵';
  if (p === 'lowest') return '⚪';
  return '';
}

function relativeTime(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function NotConfiguredBanner() {
  return React.createElement(
    'div',
    {
      style: {
        padding: '32px',
        textAlign: 'center',
        color: 'var(--app-text-muted, #888)',
      },
    },
    React.createElement('div', { style: { fontSize: 48, marginBottom: 12 } }, '🔧'),
    React.createElement(
      'p',
      { style: { fontSize: 16, fontWeight: 600, marginBottom: 8 } },
      'JIRA is not configured'
    ),
    React.createElement(
      'p',
      { style: { fontSize: 14 } },
      'Add ',
      React.createElement('code', null, 'jira.baseUrl'),
      ', ',
      React.createElement('code', null, 'jira.email'),
      ', and ',
      React.createElement('code', null, 'jira.apiToken'),
      ' to your ',
      React.createElement('code', null, '~/.config/konstruct/config.yml'),
      ' and restart.'
    )
  );
}

function IssueRow({ issue, onClick, selected }) {
  return React.createElement(
    'div',
    {
      onClick: () => onClick(issue),
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 16px',
        cursor: 'pointer',
        borderBottom: '1px solid var(--app-border, #eee)',
        background: selected ? 'var(--mantine-color-blue-0, #e8f4ff)' : 'transparent',
        transition: 'background 0.1s',
      },
      onMouseEnter: (e) => {
        if (!selected) e.currentTarget.style.background = 'var(--app-hover, rgba(0,0,0,0.04))';
      },
      onMouseLeave: (e) => {
        if (!selected) e.currentTarget.style.background = 'transparent';
      },
    },
    // Issue type icon
    issue.issueTypeIconUrl
      ? React.createElement('img', {
          src: issue.issueTypeIconUrl,
          width: 16,
          height: 16,
          style: { flexShrink: 0 },
          alt: issue.issueType,
        })
      : React.createElement(
          'span',
          { style: { width: 16, flexShrink: 0, fontSize: 12 } },
          '📋'
        ),
    // Key
    React.createElement(
      'span',
      {
        style: {
          fontFamily: 'monospace',
          fontSize: 12,
          color: 'var(--mantine-color-blue-6, #1971c2)',
          flexShrink: 0,
          minWidth: 80,
        },
      },
      issue.key
    ),
    // Summary
    React.createElement(
      'span',
      {
        style: {
          flex: 1,
          fontSize: 14,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        },
      },
      issue.summary
    ),
    // Priority
    issue.priority
      ? React.createElement(
          'span',
          { style: { flexShrink: 0, fontSize: 13 }, title: issue.priority },
          priorityEmoji(issue.priority)
        )
      : null,
    // Status badge
    React.createElement(
      'span',
      {
        style: {
          flexShrink: 0,
          fontSize: 11,
          fontWeight: 600,
          padding: '2px 8px',
          borderRadius: 10,
          background: statusColor(issue.statusColor) + '22',
          color: statusColor(issue.statusColor),
          border: `1px solid ${statusColor(issue.statusColor)}44`,
          whiteSpace: 'nowrap',
        },
      },
      issue.status
    ),
    // Assignee avatar or initials
    issue.assigneeAvatar
      ? React.createElement('img', {
          src: issue.assigneeAvatar,
          width: 20,
          height: 20,
          style: { borderRadius: '50%', flexShrink: 0 },
          title: issue.assignee ?? '',
        })
      : issue.assignee
        ? React.createElement(
            'span',
            {
              title: issue.assignee,
              style: {
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: '#ddd',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
                fontWeight: 700,
                flexShrink: 0,
              },
            },
            issue.assignee.charAt(0).toUpperCase()
          )
        : React.createElement('span', { style: { width: 20, flexShrink: 0 } }),
    // Updated
    React.createElement(
      'span',
      {
        style: {
          flexShrink: 0,
          fontSize: 11,
          color: 'var(--app-text-muted, #888)',
          minWidth: 54,
          textAlign: 'right',
        },
      },
      relativeTime(issue.updated)
    )
  );
}

function IssueDetail({ issueKey, onClose }) {
  const { data, isLoading } = trpc.jira.getIssue.useQuery({ issueKey });

  const issue = data?.issue;

  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      },
    },
    // Header
    React.createElement(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: '1px solid var(--app-border, #eee)',
          flexShrink: 0,
        },
      },
      React.createElement(
        'span',
        {
          style: {
            fontFamily: 'monospace',
            fontSize: 13,
            fontWeight: 700,
            color: 'var(--mantine-color-blue-6, #1971c2)',
          },
        },
        issueKey
      ),
      React.createElement(
        'button',
        {
          onClick: onClose,
          style: {
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 18,
            color: 'var(--app-text-muted, #888)',
            lineHeight: 1,
            padding: '0 4px',
          },
          'aria-label': 'Close',
        },
        '×'
      )
    ),
    // Body
    isLoading
      ? React.createElement(
          'div',
          { style: { padding: 32, textAlign: 'center', color: 'var(--app-text-muted, #888)' } },
          'Loading…'
        )
      : !issue
        ? React.createElement(
            'div',
            { style: { padding: 32, color: 'red' } },
            data?.error ?? 'Failed to load issue'
          )
        : React.createElement(
            'div',
            { style: { flex: 1, overflow: 'auto', padding: 16 } },
            // Title
            React.createElement(
              'h2',
              { style: { margin: '0 0 12px', fontSize: 18, fontWeight: 700 } },
              issue.summary
            ),
            // Meta row
            React.createElement(
              'div',
              {
                style: {
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 12,
                  marginBottom: 16,
                  fontSize: 13,
                },
              },
              // Status
              React.createElement(
                'span',
                {
                  style: {
                    padding: '2px 10px',
                    borderRadius: 10,
                    background: statusColor(issue.statusColor) + '22',
                    color: statusColor(issue.statusColor),
                    border: `1px solid ${statusColor(issue.statusColor)}44`,
                    fontWeight: 600,
                  },
                },
                issue.status
              ),
              // Issue type
              React.createElement('span', { style: { color: 'var(--app-text-muted, #888)' } }, issue.issueType),
              // Priority
              issue.priority &&
                React.createElement(
                  'span',
                  null,
                  priorityEmoji(issue.priority),
                  ' ',
                  issue.priority
                ),
              // Assignee
              issue.assignee &&
                React.createElement(
                  'span',
                  { style: { color: 'var(--app-text-muted, #888)' } },
                  '👤 ',
                  issue.assignee
                ),
              // Updated
              React.createElement(
                'span',
                { style: { color: 'var(--app-text-muted, #888)' } },
                'Updated ',
                relativeTime(issue.updated)
              )
            ),
            // Labels
            issue.labels.length > 0 &&
              React.createElement(
                'div',
                { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 } },
                issue.labels.map((lbl) =>
                  React.createElement(
                    'span',
                    {
                      key: lbl,
                      style: {
                        fontSize: 11,
                        padding: '2px 8px',
                        borderRadius: 10,
                        background: 'var(--mantine-color-gray-1, #f1f3f5)',
                        color: 'var(--app-text, #333)',
                        border: '1px solid var(--app-border, #ddd)',
                      },
                    },
                    lbl
                  )
                )
              ),
            // Description
            issue.description &&
              React.createElement(
                'div',
                { style: { marginBottom: 20 } },
                React.createElement(
                  'h3',
                  { style: { fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--app-text-muted, #888)' } },
                  'DESCRIPTION'
                ),
                React.createElement(
                  'p',
                  {
                    style: {
                      fontSize: 14,
                      lineHeight: 1.6,
                      whiteSpace: 'pre-wrap',
                      margin: 0,
                    },
                  },
                  issue.description
                )
              ),
            // Comments
            issue.comments.length > 0 &&
              React.createElement(
                'div',
                null,
                React.createElement(
                  'h3',
                  {
                    style: {
                      fontSize: 13,
                      fontWeight: 600,
                      marginBottom: 12,
                      color: 'var(--app-text-muted, #888)',
                    },
                  },
                  `COMMENTS (${issue.comments.length})`
                ),
                issue.comments.map((c) =>
                  React.createElement(
                    'div',
                    {
                      key: c.id,
                      style: {
                        marginBottom: 16,
                        padding: 12,
                        borderRadius: 8,
                        background: 'var(--app-surface, #f8f9fa)',
                        border: '1px solid var(--app-border, #eee)',
                      },
                    },
                    React.createElement(
                      'div',
                      {
                        style: {
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          marginBottom: 8,
                        },
                      },
                      c.authorAvatar
                        ? React.createElement('img', {
                            src: c.authorAvatar,
                            width: 20,
                            height: 20,
                            style: { borderRadius: '50%' },
                          })
                        : null,
                      React.createElement(
                        'span',
                        { style: { fontSize: 13, fontWeight: 600 } },
                        c.author
                      ),
                      React.createElement(
                        'span',
                        { style: { fontSize: 11, color: 'var(--app-text-muted, #888)' } },
                        relativeTime(c.created)
                      )
                    ),
                    React.createElement(
                      'p',
                      {
                        style: {
                          margin: 0,
                          fontSize: 13,
                          lineHeight: 1.6,
                          whiteSpace: 'pre-wrap',
                        },
                      },
                      c.body
                    )
                  )
                )
              )
          )
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function JiraPage() {
  const [jql, setJql] = useState('assignee = currentUser() ORDER BY updated DESC');
  const [draftJql, setDraftJql] = useState(jql);
  const [selectedIssue, setSelectedIssue] = useState(null);

  const { data: configData } = trpc.jira.isConfigured.useQuery();
  const isConfigured = configData?.configured ?? false;

  const { data, isLoading, isError, refetch } = trpc.jira.searchIssues.useQuery(
    { jql, maxResults: 50 },
    { enabled: isConfigured }
  );

  const handleSearch = useCallback(
    (e) => {
      e.preventDefault();
      setJql(draftJql);
      setSelectedIssue(null);
    },
    [draftJql]
  );

  const handleSelectIssue = useCallback((issue) => {
    setSelectedIssue((prev) => (prev?.key === issue.key ? null : issue));
  }, []);

  if (!isConfigured && configData !== undefined) {
    return React.createElement(NotConfiguredBanner);
  }

  return React.createElement(
    'div',
    {
      style: {
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      },
    },
    // Top bar
    React.createElement(
      'div',
      {
        style: {
          padding: '12px 16px',
          borderBottom: '1px solid var(--app-border, #eee)',
          background: 'var(--app-surface, #fff)',
          flexShrink: 0,
        },
      },
      React.createElement(
        'form',
        {
          onSubmit: handleSearch,
          style: { display: 'flex', gap: 8, alignItems: 'center' },
        },
        React.createElement(
          'span',
          { style: { fontWeight: 700, fontSize: 16, marginRight: 4 } },
          '🎫 JIRA'
        ),
        React.createElement('input', {
          value: draftJql,
          onChange: (e) => setDraftJql(e.target.value),
          placeholder: 'JQL query…',
          style: {
            flex: 1,
            padding: '6px 10px',
            borderRadius: 6,
            border: '1px solid var(--app-border, #ccc)',
            fontSize: 13,
            fontFamily: 'monospace',
            background: 'var(--app-bg, #fff)',
            color: 'var(--app-text, #333)',
          },
        }),
        React.createElement(
          'button',
          {
            type: 'submit',
            style: {
              padding: '6px 16px',
              borderRadius: 6,
              border: 'none',
              background: 'var(--mantine-color-blue-6, #1971c2)',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
            },
          },
          'Search'
        ),
        React.createElement(
          'button',
          {
            type: 'button',
            onClick: () => refetch(),
            title: 'Refresh',
            style: {
              padding: '6px 10px',
              borderRadius: 6,
              border: '1px solid var(--app-border, #ccc)',
              background: 'transparent',
              cursor: 'pointer',
              fontSize: 14,
            },
          },
          '↻'
        )
      ),
      // Quick filters
      React.createElement(
        'div',
        { style: { display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' } },
        [
          ['My open issues', 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC'],
          ['All open', 'statusCategory != Done ORDER BY updated DESC'],
          ['In Progress', 'status = "In Progress" ORDER BY updated DESC'],
          ['Recently updated', 'ORDER BY updated DESC'],
        ].map(([name, q]) =>
          React.createElement(
            'button',
            {
              key: name,
              type: 'button',
              onClick: () => {
                setDraftJql(q);
                setJql(q);
                setSelectedIssue(null);
              },
              style: {
                padding: '3px 10px',
                borderRadius: 12,
                border: `1px solid ${jql === q ? 'var(--mantine-color-blue-5, #339af0)' : 'var(--app-border, #ccc)'}`,
                background: jql === q ? 'var(--mantine-color-blue-0, #e8f4ff)' : 'transparent',
                color: jql === q ? 'var(--mantine-color-blue-7, #1864ab)' : 'var(--app-text, #333)',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: jql === q ? 600 : 400,
              },
            },
            name
          )
        )
      )
    ),
    // Main content — list + optional detail panel
    React.createElement(
      'div',
      { style: { display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' } },
      // Issue list
      React.createElement(
        'div',
        {
          style: {
            flex: selectedIssue ? '0 0 50%' : '1',
            overflow: 'auto',
            borderRight: selectedIssue ? '1px solid var(--app-border, #eee)' : 'none',
            transition: 'flex 0.2s',
          },
        },
        isLoading
          ? React.createElement(
              'div',
              {
                style: {
                  padding: 32,
                  textAlign: 'center',
                  color: 'var(--app-text-muted, #888)',
                },
              },
              'Loading…'
            )
          : isError || data?.error
            ? React.createElement(
                'div',
                {
                  style: {
                    padding: 32,
                    textAlign: 'center',
                    color: 'red',
                    fontSize: 14,
                  },
                },
                data?.error === 'not_configured'
                  ? 'JIRA is not configured.'
                  : `Error: ${data?.error ?? 'Unknown error'}`
              )
            : !data || data.issues.length === 0
              ? React.createElement(
                  'div',
                  {
                    style: {
                      padding: 32,
                      textAlign: 'center',
                      color: 'var(--app-text-muted, #888)',
                    },
                  },
                  'No issues found.'
                )
              : React.createElement(
                  'div',
                  null,
                  // Result count
                  React.createElement(
                    'div',
                    {
                      style: {
                        padding: '6px 16px',
                        fontSize: 12,
                        color: 'var(--app-text-muted, #888)',
                        borderBottom: '1px solid var(--app-border, #eee)',
                      },
                    },
                    `${data.total} result${data.total === 1 ? '' : 's'}`
                  ),
                  data.issues.map((issue) =>
                    React.createElement(IssueRow, {
                      key: issue.id,
                      issue,
                      onClick: handleSelectIssue,
                      selected: selectedIssue?.key === issue.key,
                    })
                  )
                )
      ),
      // Detail panel
      selectedIssue &&
        React.createElement(
          'div',
          { style: { flex: '0 0 50%', overflow: 'hidden', display: 'flex', flexDirection: 'column' } },
          React.createElement(IssueDetail, {
            issueKey: selectedIssue.key,
            onClose: () => setSelectedIssue(null),
          })
        )
    )
  );
}
