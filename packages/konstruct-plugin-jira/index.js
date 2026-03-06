/**
 * Konstruct JIRA plugin.
 *
 * Requires the following in ~/.config/konstruct/config.yml:
 *
 *   plugins:
 *     enabled:
 *       - jira
 *
 *   jira:
 *     baseUrl: https://your-org.atlassian.net
 *     email: you@example.com
 *     apiToken: YOUR_ATLASSIAN_API_TOKEN
 *
 * Uses JIRA REST API v3. Authentication is Basic: base64(email:apiToken).
 */

'use strict';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wrap plain text in Atlassian Document Format (ADF).
 * @param {string} text
 * @returns {object}
 */
function toAdf(text) {
  return {
    version: 1,
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: String(text) }],
      },
    ],
  };
}

/**
 * Make an authenticated request to the JIRA REST API v3.
 *
 * @param {{ baseUrl: string, email: string, apiToken: string }} cfg
 * @param {string} path  Path relative to /rest/api/3/ (e.g. "issue/PROJ-1")
 * @param {RequestInit} [options]
 * @returns {Promise<any>}
 */
async function jiraFetch(cfg, path, options = {}) {
  const { baseUrl, email, apiToken } = cfg;

  if (!baseUrl || !email || !apiToken) {
    throw new Error(
      'JIRA plugin is not configured. Set jira.baseUrl, jira.email, and jira.apiToken in config.',
    );
  }

  const url = `${baseUrl.replace(/\/$/, '')}/rest/api/3/${path}`;
  const credentials = Buffer.from(`${email}:${apiToken}`).toString('base64');

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Basic ${credentials}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`JIRA API error ${response.status}: ${text}`);
  }

  // 204 No Content — return empty object
  if (response.status === 204) return {};

  return response.json();
}

/**
 * Validate that plugin config contains the required credentials and return an
 * error object if not (so tools can return early).
 *
 * @param {object} cfg
 * @returns {{ error: string } | null}
 */
function configError(cfg) {
  if (!cfg || !cfg.baseUrl || !cfg.email || !cfg.apiToken) {
    return {
      error:
        'JIRA plugin is not configured. Set jira.baseUrl, jira.email, and jira.apiToken in config.',
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------

function register(api) {
  const { registerTool, addToolDefinitions, pluginConfig } = api;

  // pluginConfig is the object at the "jira:" key in config.yml
  const cfg = pluginConfig ?? {};

  // ------------------------------------------------------------------
  // Tool definitions (schema)
  // ------------------------------------------------------------------
  addToolDefinitions([
    // jira_get_issue
    {
      type: 'function',
      function: {
        name: 'jira_get_issue',
        description:
          'Get a JIRA issue by its key (e.g. PROJ-123). Returns summary, description, status, assignee, priority, labels, and comments.',
        parameters: {
          type: 'object',
          properties: {
            issueKey: {
              type: 'string',
              description: 'The JIRA issue key, e.g. PROJ-123.',
            },
          },
          required: ['issueKey'],
        },
      },
    },

    // jira_search_issues
    {
      type: 'function',
      function: {
        name: 'jira_search_issues',
        description:
          'Search JIRA issues using JQL (JIRA Query Language). Returns a list of matching issues with key, summary, status, assignee, and priority.',
        parameters: {
          type: 'object',
          properties: {
            jql: {
              type: 'string',
              description: 'JQL query string, e.g. "project = PROJ AND status = Open".',
            },
            maxResults: {
              type: 'number',
              description: 'Maximum number of results to return (default: 20).',
            },
          },
          required: ['jql'],
        },
      },
    },

    // jira_create_issue
    {
      type: 'function',
      function: {
        name: 'jira_create_issue',
        description: 'Create a new JIRA issue.',
        parameters: {
          type: 'object',
          properties: {
            projectKey: {
              type: 'string',
              description: 'The project key, e.g. PROJ.',
            },
            summary: {
              type: 'string',
              description: 'Issue summary / title.',
            },
            issueType: {
              type: 'string',
              description: 'Issue type name (default: "Task").',
            },
            description: {
              type: 'string',
              description: 'Issue description (plain text).',
            },
            priority: {
              type: 'string',
              description: 'Priority name, e.g. "High", "Medium", "Low".',
            },
            assigneeEmail: {
              type: 'string',
              description: 'Email address of the user to assign the issue to.',
            },
          },
          required: ['projectKey', 'summary'],
        },
      },
    },

    // jira_update_issue
    {
      type: 'function',
      function: {
        name: 'jira_update_issue',
        description: 'Update fields on an existing JIRA issue.',
        parameters: {
          type: 'object',
          properties: {
            issueKey: {
              type: 'string',
              description: 'The JIRA issue key, e.g. PROJ-123.',
            },
            summary: {
              type: 'string',
              description: 'New summary / title.',
            },
            description: {
              type: 'string',
              description: 'New description (plain text).',
            },
            priority: {
              type: 'string',
              description: 'New priority name, e.g. "High".',
            },
          },
          required: ['issueKey'],
        },
      },
    },

    // jira_add_comment
    {
      type: 'function',
      function: {
        name: 'jira_add_comment',
        description: 'Add a comment to a JIRA issue.',
        parameters: {
          type: 'object',
          properties: {
            issueKey: {
              type: 'string',
              description: 'The JIRA issue key, e.g. PROJ-123.',
            },
            comment: {
              type: 'string',
              description: 'Comment text (plain text).',
            },
          },
          required: ['issueKey', 'comment'],
        },
      },
    },

    // jira_transition_issue
    {
      type: 'function',
      function: {
        name: 'jira_transition_issue',
        description:
          'Transition a JIRA issue to a different status (e.g. "In Progress", "Done"). Fetches available transitions and matches the name case-insensitively.',
        parameters: {
          type: 'object',
          properties: {
            issueKey: {
              type: 'string',
              description: 'The JIRA issue key, e.g. PROJ-123.',
            },
            transitionName: {
              type: 'string',
              description: 'Name of the transition to apply, e.g. "In Progress" or "Done".',
            },
          },
          required: ['issueKey', 'transitionName'],
        },
      },
    },

    // jira_get_projects
    {
      type: 'function',
      function: {
        name: 'jira_get_projects',
        description: 'List available JIRA projects the authenticated user has access to.',
        parameters: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
    },
  ]);

  // ------------------------------------------------------------------
  // Tool handlers
  // ------------------------------------------------------------------

  // jira_get_issue
  registerTool('jira_get_issue', async (args) => {
    const err = configError(cfg);
    if (err) return err;

    try {
      const { issueKey } = args;
      const data = await jiraFetch(
        cfg,
        `issue/${encodeURIComponent(issueKey)}?fields=summary,description,status,assignee,priority,labels,comment`,
      );

      const fields = data.fields ?? {};
      return {
        key: data.key,
        summary: fields.summary,
        status: fields.status?.name,
        assignee: fields.assignee?.displayName ?? fields.assignee?.emailAddress ?? null,
        priority: fields.priority?.name,
        labels: fields.labels ?? [],
        description: extractText(fields.description),
        comments: (fields.comment?.comments ?? []).map((c) => ({
          author: c.author?.displayName ?? c.author?.emailAddress,
          created: c.created,
          body: extractText(c.body),
        })),
      };
    } catch (e) {
      return { error: e.message };
    }
  });

  // jira_search_issues
  registerTool('jira_search_issues', async (args) => {
    const err = configError(cfg);
    if (err) return err;

    try {
      const { jql, maxResults = 20 } = args;
      const params = new URLSearchParams({
        jql,
        maxResults: String(maxResults),
        fields: 'summary,status,assignee,priority',
      });
      const data = await jiraFetch(cfg, `search?${params.toString()}`);

      return {
        total: data.total,
        issues: (data.issues ?? []).map((issue) => ({
          key: issue.key,
          summary: issue.fields?.summary,
          status: issue.fields?.status?.name,
          assignee:
            issue.fields?.assignee?.displayName ?? issue.fields?.assignee?.emailAddress ?? null,
          priority: issue.fields?.priority?.name,
        })),
      };
    } catch (e) {
      return { error: e.message };
    }
  });

  // jira_create_issue
  registerTool('jira_create_issue', async (args) => {
    const err = configError(cfg);
    if (err) return err;

    try {
      const {
        projectKey,
        summary,
        issueType = 'Task',
        description,
        priority,
        assigneeEmail,
      } = args;

      const fields = {
        project: { key: projectKey },
        summary,
        issuetype: { name: issueType },
      };

      if (description) {
        fields.description = toAdf(description);
      }

      if (priority) {
        fields.priority = { name: priority };
      }

      if (assigneeEmail) {
        // Look up account ID by email
        const users = await jiraFetch(
          cfg,
          `user/search?query=${encodeURIComponent(assigneeEmail)}`,
        );
        if (users && users.length > 0) {
          fields.assignee = { accountId: users[0].accountId };
        }
      }

      const data = await jiraFetch(cfg, 'issue', {
        method: 'POST',
        body: JSON.stringify({ fields }),
      });

      return { key: data.key, id: data.id, self: data.self };
    } catch (e) {
      return { error: e.message };
    }
  });

  // jira_update_issue
  registerTool('jira_update_issue', async (args) => {
    const err = configError(cfg);
    if (err) return err;

    try {
      const { issueKey, summary, description, priority } = args;

      const fields = {};

      if (summary !== undefined) fields.summary = summary;
      if (description !== undefined) fields.description = toAdf(description);
      if (priority !== undefined) fields.priority = { name: priority };

      if (Object.keys(fields).length === 0) {
        return { error: 'No fields provided to update.' };
      }

      await jiraFetch(cfg, `issue/${encodeURIComponent(issueKey)}`, {
        method: 'PUT',
        body: JSON.stringify({ fields }),
      });

      return { success: true, issueKey };
    } catch (e) {
      return { error: e.message };
    }
  });

  // jira_add_comment
  registerTool('jira_add_comment', async (args) => {
    const err = configError(cfg);
    if (err) return err;

    try {
      const { issueKey, comment } = args;

      const data = await jiraFetch(cfg, `issue/${encodeURIComponent(issueKey)}/comment`, {
        method: 'POST',
        body: JSON.stringify({ body: toAdf(comment) }),
      });

      return { id: data.id, self: data.self };
    } catch (e) {
      return { error: e.message };
    }
  });

  // jira_transition_issue
  registerTool('jira_transition_issue', async (args) => {
    const err = configError(cfg);
    if (err) return err;

    try {
      const { issueKey, transitionName } = args;

      // Fetch available transitions
      const data = await jiraFetch(
        cfg,
        `issue/${encodeURIComponent(issueKey)}/transitions`,
      );

      const transitions = data.transitions ?? [];
      const match = transitions.find(
        (t) => t.name.toLowerCase() === transitionName.toLowerCase(),
      );

      if (!match) {
        const available = transitions.map((t) => t.name).join(', ');
        return {
          error: `Transition "${transitionName}" not found. Available transitions: ${available}`,
        };
      }

      await jiraFetch(cfg, `issue/${encodeURIComponent(issueKey)}/transitions`, {
        method: 'POST',
        body: JSON.stringify({ transition: { id: match.id } }),
      });

      return { success: true, issueKey, transition: match.name };
    } catch (e) {
      return { error: e.message };
    }
  });

  // jira_get_projects
  registerTool('jira_get_projects', async (_args) => {
    const err = configError(cfg);
    if (err) return err;

    try {
      const projects = await jiraFetch(cfg, 'project');

      return {
        projects: (Array.isArray(projects) ? projects : []).map((p) => ({
          id: p.id,
          key: p.key,
          name: p.name,
          projectTypeKey: p.projectTypeKey,
        })),
      };
    } catch (e) {
      return { error: e.message };
    }
  });
}

// ---------------------------------------------------------------------------
// Utility: extract plain text from ADF or string descriptions
// ---------------------------------------------------------------------------

/**
 * Recursively extract text from an Atlassian Document Format node (or plain string).
 * @param {any} node
 * @returns {string}
 */
function extractText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.type === 'text') return node.text ?? '';
  if (Array.isArray(node.content)) {
    return node.content.map(extractText).join('');
  }
  return '';
}

module.exports = { register };
