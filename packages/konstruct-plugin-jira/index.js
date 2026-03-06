/**
 * Konstruct JIRA Cloud plugin.
 *
 * Add to config:
 *   plugins:
 *     enabled: [jira]
 *   jira:
 *     baseUrl: https://your-org.atlassian.net
 *     email: you@example.com
 *     apiToken: your-api-token
 *
 * Registered tools (for AI agent):
 *   jira_get_issue, jira_search_issues, jira_create_issue,
 *   jira_update_issue, jira_add_comment, jira_transition_issue,
 *   jira_get_projects
 *
 * Registered tRPC router (for frontend search/detail view):
 *   jira.isConfigured, jira.searchIssues, jira.getIssue, jira.getProjects
 */

/** Convert plain text to the minimal Atlassian Document Format (ADF) required by v3 endpoints. */
function textToAdf(text) {
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

/** Extract plain text from an Atlassian Document Format (ADF) node. */
function adfToText(node) {
  if (!node || typeof node !== 'object') return '';
  if (node.type === 'text' && typeof node.text === 'string') return node.text;
  if (Array.isArray(node.content)) return node.content.map(adfToText).join('');
  return '';
}

function register(api) {
  const { registerTool, addToolDefinitions, pluginConfig, trpc } = api;

  // ─── JIRA HTTP client ──────────────────────────────────────────────────────

  function authHeader() {
    const { email, apiToken } = pluginConfig ?? {};
    if (!email || !apiToken) throw new Error('JIRA plugin: missing email or apiToken in config');
    return 'Basic ' + Buffer.from(`${email}:${apiToken}`).toString('base64');
  }

  /** Make an authenticated request to the JIRA REST API v3 — shared by tools AND the tRPC router. */
  async function jiraFetch(path, options = {}) {
    const { baseUrl } = pluginConfig ?? {};
    if (!baseUrl) throw new Error('JIRA plugin: missing baseUrl in config');

    const url = `${baseUrl.replace(/\/$/, '')}/rest/api/3${path}`;
    const method = options.method ?? 'GET';

    if (options.body) {
      console.log(`[jira-plugin] → ${method} ${url}\n[jira-plugin] Request body:`, options.body);
    } else {
      console.log(`[jira-plugin] → ${method} ${url}`);
    }

    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(options.headers ?? {}),
      },
    });

    const text = await res.text();
    console.log(`[jira-plugin] ← ${res.status} ${res.statusText}`);
    console.log(`[jira-plugin] Raw response:`, text);

    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }

    if (!res.ok) {
      const msg = body?.errorMessages?.join(', ') || body?.message || `HTTP ${res.status}`;
      throw new Error(`JIRA API error: ${msg}`);
    }

    return body;
  }

  // ─── tRPC router (used by the frontend search/detail view) ────────────────

  if (trpc) {
    const { router, procedure, z } = trpc;

    const jiraRouter = router({
      /** Whether JIRA credentials are present and valid. */
      isConfigured: procedure.query(async () => {
        const { baseUrl, email, apiToken } = pluginConfig ?? {};
        return { configured: !!(baseUrl && email && apiToken) };
      }),

      /** List accessible JIRA projects. */
      getProjects: procedure.query(async () => {
        try {
          const data = await jiraFetch('/project');
          return {
            error: null,
            projects: (Array.isArray(data) ? data : []).map((p) => ({
              id: p.id,
              key: p.key,
              name: p.name,
              type: p.projectTypeKey ?? '',
              avatarUrl: p.avatarUrls?.['48x48'] ?? '',
            })),
          };
        } catch (e) {
          return { error: String(e instanceof Error ? e.message : e), projects: [] };
        }
      }),

      /** Search issues with JQL — uses the new /search/jql endpoint. */
      searchIssues: procedure
        .input(
          z.object({
            jql: z.string(),
            maxResults: z.number().int().min(1).max(100).optional().default(50),
            nextPageToken: z.string().optional(),
          })
        )
        .query(async ({ input }) => {
          try {
            // Use POST with a JSON body — the GET variant with query params silently
            // returns empty results for many orgs even with a valid 200 response.
            const body = {
              jql: input.jql,
              maxResults: input.maxResults,
              fields: ['summary', 'status', 'assignee', 'priority', 'issuetype', 'created', 'updated', 'labels'],
            };
            if (input.nextPageToken) body.nextPageToken = input.nextPageToken;

            const data = await jiraFetch('/search/jql', {
              method: 'POST',
              body: JSON.stringify(body),
            });
            return {
              error: null,
              total: data.total ?? 0,
              nextPageToken: data.nextPageToken ?? null,
              issues: (data.issues ?? []).map((i) => ({
                id: i.id,
                key: i.key,
                summary: i.fields.summary,
                status: i.fields.status?.name ?? '',
                statusColor: i.fields.status?.statusCategory?.colorName ?? '',
                assignee: i.fields.assignee?.displayName ?? null,
                assigneeAvatar: i.fields.assignee?.avatarUrls?.['24x24'] ?? null,
                priority: i.fields.priority?.name ?? null,
                priorityIconUrl: i.fields.priority?.iconUrl ?? null,
                issueType: i.fields.issuetype?.name ?? i.fields.type?.name ?? '',
                issueTypeIconUrl: i.fields.issuetype?.iconUrl ?? i.fields.type?.iconUrl ?? null,
                created: i.fields.created,
                updated: i.fields.updated,
                labels: i.fields.labels ?? [],
              })),
            };
          } catch (e) {
            return { error: String(e instanceof Error ? e.message : e), issues: [], total: 0, nextPageToken: null };
          }
        }),

      /** Get a single issue by key with full details and comments. */
      getIssue: procedure
        .input(z.object({ issueKey: z.string() }))
        .query(async ({ input }) => {
          try {
            const data = await jiraFetch(
              `/issue/${input.issueKey}?fields=summary,description,status,assignee,priority,labels,comment,created,updated`
            );
            return {
              error: null,
              issue: {
                id: data.id,
                key: data.key,
                summary: data.fields.summary,
                description: adfToText(data.fields.description),
                status: data.fields.status?.name ?? '',
                statusColor: data.fields.status?.statusCategory?.colorName ?? '',
                assignee: data.fields.assignee?.displayName ?? null,
                assigneeAvatar: data.fields.assignee?.avatarUrls?.['48x48'] ?? null,
                priority: data.fields.priority?.name ?? null,
                issueType: data.fields.issuetype?.name ?? data.fields.type?.name ?? '',
                issueTypeIconUrl: data.fields.issuetype?.iconUrl ?? data.fields.type?.iconUrl ?? null,
                labels: data.fields.labels ?? [],
                created: data.fields.created,
                updated: data.fields.updated,
                comments: (data.fields.comment?.comments ?? []).map((c) => ({
                  id: c.id,
                  author: c.author.displayName,
                  authorAvatar: c.author.avatarUrls?.['24x24'] ?? null,
                  body: adfToText(c.body),
                  created: c.created,
                })),
              },
            };
          } catch (e) {
            return { error: String(e instanceof Error ? e.message : e), issue: null };
          }
        }),
    });

    api.registerRouter('jira', jiraRouter);
  }

  // ─── Tool definitions (for the AI agent) ──────────────────────────────────

  addToolDefinitions([
    {
      type: 'function',
      function: {
        name: 'jira_get_issue',
        description: 'Get a JIRA issue by its key (e.g. PROJ-123). Returns summary, description, status, assignee, priority, labels, and comments.',
        parameters: {
          type: 'object',
          properties: {
            issueKey: { type: 'string', description: 'The JIRA issue key, e.g. PROJ-123.' },
          },
          required: ['issueKey'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'jira_search_issues',
        description: 'Search JIRA issues using JQL (JIRA Query Language). Returns a list of matching issues with key, summary, status, assignee, and priority.',
        parameters: {
          type: 'object',
          properties: {
            jql: { type: 'string', description: 'JQL query string, e.g. "project = PROJ AND status = Open".' },
            maxResults: { type: 'number', description: 'Maximum number of results to return (default: 20).' },
          },
          required: ['jql'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'jira_create_issue',
        description: 'Create a new JIRA issue.',
        parameters: {
          type: 'object',
          properties: {
            projectKey: { type: 'string', description: 'The project key, e.g. PROJ.' },
            summary: { type: 'string', description: 'Issue summary / title.' },
            description: { type: 'string', description: 'Issue description (plain text).' },
            issueType: { type: 'string', description: 'Issue type name (default: "Task").' },
            priority: { type: 'string', description: 'Priority name, e.g. "High", "Medium", "Low".' },
            assigneeEmail: { type: 'string', description: 'Email address of the user to assign the issue to.' },
          },
          required: ['projectKey', 'summary'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'jira_update_issue',
        description: 'Update fields on an existing JIRA issue.',
        parameters: {
          type: 'object',
          properties: {
            issueKey: { type: 'string', description: 'The JIRA issue key, e.g. PROJ-123.' },
            summary: { type: 'string', description: 'New summary / title.' },
            description: { type: 'string', description: 'New description (plain text).' },
            priority: { type: 'string', description: 'New priority name, e.g. "High".' },
          },
          required: ['issueKey'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'jira_add_comment',
        description: 'Add a comment to a JIRA issue.',
        parameters: {
          type: 'object',
          properties: {
            issueKey: { type: 'string', description: 'The JIRA issue key, e.g. PROJ-123.' },
            comment: { type: 'string', description: 'Comment text (plain text).' },
          },
          required: ['issueKey', 'comment'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'jira_transition_issue',
        description: 'Transition a JIRA issue to a different status (e.g. "In Progress", "Done"). Fetches available transitions and matches the name case-insensitively.',
        parameters: {
          type: 'object',
          properties: {
            issueKey: { type: 'string', description: 'The JIRA issue key, e.g. PROJ-123.' },
            transitionName: { type: 'string', description: 'Name of the transition to apply, e.g. "In Progress" or "Done".' },
          },
          required: ['issueKey', 'transitionName'],
        },
      },
    },
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

  // ─── Tool implementations (for the AI agent) ──────────────────────────────

  registerTool('jira_get_issue', async ({ issueKey }) => {
    try {
      const issue = await jiraFetch(`/issue/${encodeURIComponent(issueKey)}?expand=renderedFields,names`);
      const f = issue.fields ?? {};
      return {
        key: issue.key,
        summary: f.summary,
        status: f.status?.name,
        assignee: f.assignee?.emailAddress ?? f.assignee?.displayName ?? null,
        priority: f.priority?.name,
        labels: f.labels ?? [],
        description: adfToText(f.description),
        comments: (f.comment?.comments ?? []).map((c) => ({
          author: c.author?.displayName,
          body: adfToText(c.body),
          created: c.created,
        })),
      };
    } catch (err) {
      return { error: err.message };
    }
  });

  registerTool('jira_search_issues', async ({ jql, maxResults = 20 }) => {
    try {
      // Use POST with a JSON body — the GET variant silently returns empty results for many orgs.
      const data = await jiraFetch('/search/jql', {
        method: 'POST',
        body: JSON.stringify({
          jql: String(jql),
          maxResults,
          fields: ['summary', 'status', 'assignee', 'priority', 'issuetype', 'created', 'updated', 'labels'],
        }),
      });
      return {
        total: data.total,
        issues: (data.issues ?? []).map((i) => ({
          key: i.key,
          summary: i.fields?.summary,
          status: i.fields?.status?.name,
          assignee: i.fields?.assignee?.emailAddress ?? i.fields?.assignee?.displayName ?? null,
          priority: i.fields?.priority?.name,
        })),
      };
    } catch (err) {
      return { error: err.message };
    }
  });

  registerTool('jira_create_issue', async ({ projectKey, summary, description, issueType = 'Task', priority, assigneeEmail }) => {
    try {
      const fields = {
        project: { key: projectKey },
        summary,
        issuetype: { name: issueType },
      };

      if (description) fields.description = textToAdf(description);
      if (priority) fields.priority = { name: priority };

      if (assigneeEmail) {
        try {
          const users = await jiraFetch(`/user/search?query=${encodeURIComponent(assigneeEmail)}`);
          const match = users.find((u) => u.emailAddress === assigneeEmail) ?? users[0];
          if (match) fields.assignee = { accountId: match.accountId };
        } catch {
          // Non-fatal — create issue without assignee
        }
      }

      const result = await jiraFetch('/issue', {
        method: 'POST',
        body: JSON.stringify({ fields }),
      });

      return { key: result.key, id: result.id, self: result.self };
    } catch (err) {
      return { error: err.message };
    }
  });

  registerTool('jira_update_issue', async ({ issueKey, summary, description, priority }) => {
    try {
      const fields = {};
      if (summary !== undefined) fields.summary = summary;
      if (description !== undefined) fields.description = textToAdf(description);
      if (priority !== undefined) fields.priority = { name: priority };

      await jiraFetch(`/issue/${encodeURIComponent(issueKey)}`, {
        method: 'PUT',
        body: JSON.stringify({ fields }),
      });

      return { success: true, key: issueKey };
    } catch (err) {
      return { error: err.message };
    }
  });

  registerTool('jira_add_comment', async ({ issueKey, comment }) => {
    try {
      const result = await jiraFetch(`/issue/${encodeURIComponent(issueKey)}/comment`, {
        method: 'POST',
        body: JSON.stringify({ body: textToAdf(comment) }),
      });

      return { id: result.id, created: result.created };
    } catch (err) {
      return { error: err.message };
    }
  });

  registerTool('jira_transition_issue', async ({ issueKey, transitionName }) => {
    try {
      const { transitions } = await jiraFetch(`/issue/${encodeURIComponent(issueKey)}/transitions`);
      const target = (transitions ?? []).find(
        (t) => t.name.toLowerCase() === transitionName.toLowerCase()
      );

      if (!target) {
        const available = (transitions ?? []).map((t) => t.name).join(', ');
        return { error: `Transition "${transitionName}" not found. Available: ${available}` };
      }

      await jiraFetch(`/issue/${encodeURIComponent(issueKey)}/transitions`, {
        method: 'POST',
        body: JSON.stringify({ transition: { id: target.id } }),
      });

      return { success: true, key: issueKey, transitionedTo: target.name };
    } catch (err) {
      return { error: err.message };
    }
  });

  registerTool('jira_get_projects', async () => {
    try {
      const projects = await jiraFetch('/project/search?orderBy=name');
      return {
        projects: (projects.values ?? []).map((p) => ({
          key: p.key,
          name: p.name,
          type: p.projectTypeKey,
          lead: p.lead?.displayName ?? null,
        })),
      };
    } catch (err) {
      return { error: err.message };
    }
  });
}

module.exports = { register };
