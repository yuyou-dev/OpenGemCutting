import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  DESIGN_API_VERSION,
  DESIGN_TOOLS,
} from '../src/application/designContract.js';
import { startHost } from './host.mjs';
import {
  indexCandidates,
  planeThroughNodes,
  inspectPlane,
} from '../src/domain/sharedPlanes.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = await startHost({ root });
const server = new Server(
  { name: 'facet-96-design', version: '1.0.0' },
  {
    capabilities: { tools: {}, resources: {}, prompts: {} },
    instructions:
      'Read facet://guide and workbench_open first. Bind a specific browser session using workbench_sessions, then design_read. Plan, inspect actual images, commit, and save. Manual drafts must be completed in the workbench. Geometry rules and tools share application source. This server does not generate images or claim optical or aesthetic quality.',
  },
);
const extraTools = [
  {
    name: 'workbench_open',
    description:
      'Return the explicitly enabled local AI workbench URL. Open it in a browser; a plain static deployment needs no MCP.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'workbench_sessions',
    description:
      'List connected browser page sessions. Never guess a session when more than one page is connected.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'construction_plane',
    description:
      'Pure geometry: enumerate nearby exact 96-tooth indices or construct a plane through two 3D nodes at an explicit integer index. Optional assigned/protected nodes diagnose coplanarity and half-space feasibility. Does not alter a document.',
    inputSchema: {
      type: 'object',
      properties: {
        angleDegrees: { type: 'number' },
        index: { type: 'integer', minimum: 0, maximum: 95 },
        a: {
          type: 'array',
          items: { type: 'number' },
          minItems: 3,
          maxItems: 3,
        },
        b: {
          type: 'array',
          items: { type: 'number' },
          minItems: 3,
          maxItems: 3,
        },
        region: { type: 'string', enum: ['crown', 'pavilion'] },
        nodes: {
          type: 'array',
          items: {
            type: 'array',
            items: { type: 'number' },
            minItems: 3,
            maxItems: 3,
          },
        },
        protectedNodes: {
          type: 'array',
          items: {
            type: 'array',
            items: { type: 'number' },
            minItems: 3,
            maxItems: 3,
          },
        },
      },
      additionalProperties: false,
    },
  },
];
const resources = [
  ['facet://guide', '本地对话设计入门', 'docs/mcp/README.md'],
  ['facet://architecture', '同源架构与兼容规则', 'docs/mcp/architecture.md'],
  ['facet://examples', '可执行设计案例', 'docs/mcp/examples.md'],
  ['facet://state', '工作台状态契约', 'state-contract.md'],
  [
    'facet://skill',
    '参数化设计工作流',
    '.agents/skills/facet-parametric-design/SKILL.md',
  ],
  ['facet://capabilities', '机器可读能力与参数', null],
];
for (const name of await readdir(
  path.join(root, '.agents/skills/facet-parametric-design/references'),
)) {
  if (name.endsWith('.md'))
    resources.push([
      `facet://reference/${name.slice(0, -3)}`,
      name.slice(0, -3),
      `.agents/skills/facet-parametric-design/references/${name}`,
    ]);
}
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    ...extraTools,
    ...DESIGN_TOOLS.map(({ name, description, inputSchema, mutates }) => ({
      name,
      description,
      inputSchema,
      annotations: {
        readOnlyHint: !mutates,
        destructiveHint: mutates,
        openWorldHint: false,
      },
    })),
  ],
}));
server.setRequestHandler(
  CallToolRequestSchema,
  async ({ params }, { signal }) => {
    try {
      await host.assertCurrentBuild();
      let result;
      if (params.name === 'workbench_open') {
        result = {
          url: host.url,
          apiVersion: DESIGN_API_VERSION,
          next: 'Open this URL, then call workbench_sessions and design_read.',
        };
      }
      else if (params.name === 'workbench_sessions')
        result = { sessions: host.list() };
      else if (params.name === 'construction_plane') {
        const { validateInput } =
          await import('../src/application/designContract.js');
        validateInput(extraTools[2].inputSchema, params.arguments ?? {});
        const args = params.arguments ?? {};
        if (args.angleDegrees !== undefined)
          result = { candidates: indexCandidates(args.angleDegrees) };
        else {
          if (!args.a || !args.b || args.index === undefined)
            throw new Error('Provide angleDegrees OR index, a and b.');
          const plane = planeThroughNodes(
            args.index,
            args.a,
            args.b,
            args.region ?? 'crown',
          );
          result = {
            plane,
            inspection: inspectPlane(
              plane,
              args.nodes ?? [args.a, args.b],
              args.protectedNodes ?? [],
            ),
          };
        }
      } else
        result = await host.call(params.name, params.arguments ?? {}, {
          signal,
        });
      if (result?.mimeType === 'application/pdf')
        return {
          content: [
            {
              type: 'resource_link',
              uri: result.url,
              name: '切磨技术报告.pdf',
              mimeType: result.mimeType,
              size: result.sizeBytes,
            },
          ],
          structuredContent: {
            projectId: result.projectId,
            revision: result.revision,
            mimeType: result.mimeType,
            url: result.url,
            sizeBytes: result.sizeBytes,
          },
        };
      if (result?.mimeType === 'image/png') {
        const { data, svg, ...summary } = result;
        return {
          content: [
            { type: 'text', text: JSON.stringify(summary) },
            { type: 'image', mimeType: 'image/png', data },
          ],
          structuredContent: summary,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              code: error.code ?? 'DESIGN_ERROR',
              message: error.message,
              details: error.details,
            }),
          },
        ],
      };
    }
  },
);
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: resources.map(([uri, name]) => ({
    uri,
    name,
    mimeType:
      uri === 'facet://capabilities' ? 'application/json' : 'text/markdown',
  })),
}));
server.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => {
  const item = resources.find(([uri]) => uri === params.uri);
  if (!item) throw new Error('Unknown resource');
  return {
    contents: [
      {
        uri: item[0],
        mimeType: item[2] ? 'text/markdown' : 'application/json',
        text: item[2]
          ? await readFile(path.join(root, item[2]), 'utf8')
          : JSON.stringify(
              { apiVersion: DESIGN_API_VERSION, tools: DESIGN_TOOLS },
              null,
              2,
            ),
      },
    ],
  };
});
server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [
    {
      name: 'parametric-design',
      description:
        'Create or modify an editable design using the shared operations, independent reference evidence and exact previews.',
      arguments: [{ name: 'intent', required: true }],
    },
  ],
}));
server.setRequestHandler(GetPromptRequestSchema, async ({ params }) => {
  if (params.name !== 'parametric-design') throw new Error('Unknown prompt');
  return {
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `设计目标：${params.arguments?.intent ?? ''}\n先读 facet://guide 和 facet://skill。发现并绑定工作台，读取当前项目与 revision。先建立独立参考记录；规划真实 CUT，检查各视图与连接，再提交保存。新 CUT 至少形成一个有效面；明确记录推断、偏差和待设计师判断项。`,
        },
      },
    ],
  };
});
server.onclose = () => host.close();
await server.connect(new StdioServerTransport());
