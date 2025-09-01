import { 
  type ServerConnection, 
  type AggregatedTool,
  type AggregatedResource,
  type AggregatedPrompt,
  type GatewayConfig 
} from '../types/index';

export class GatewayRegistry {
  private tools = new Map<string, AggregatedTool>();
  private resources = new Map<string, AggregatedResource>();
  private prompts = new Map<string, AggregatedPrompt>();
  private config: GatewayConfig;
  private logger: Console;

  constructor(config: GatewayConfig, logger: Console = console) {
    this.config = config;
    this.logger = logger;
  }

  /**
   * Refresh the registry by collecting capabilities from all connected servers
   */
  async refresh(connections: Map<string, ServerConnection>): Promise<void> {
    this.logger.info('Refreshing aggregated registry...');
    
    this.tools.clear();
    this.resources.clear();
    this.prompts.clear();

    for (const [serverId, connection] of connections) {
      if (connection.status !== 'connected' || !connection.client) {
        continue;
      }

      try {
        await Promise.all([
          this.collectTools(serverId, connection),
          this.collectResources(serverId, connection),
          this.collectPrompts(serverId, connection)
        ]);
      } catch (error) {
        this.logger.error(`Failed to collect capabilities from server ${serverId}: ${error}`);
      }
    }

    this.logger.info(`Registry refreshed: ${this.tools.size} tools, ${this.resources.size} resources, ${this.prompts.size} prompts`);
  }

  private async collectTools(serverId: string, connection: ServerConnection): Promise<void> {
    if (!connection.capabilities?.tools) {
      return;
    }

    try {
      const response = await connection.client!.listTools();
      const namespace = connection.config.namespace;

      for (const tool of response.tools || []) {
        const aggregatedTool: AggregatedTool = {
          name: this.getNameWithNamespace(tool.name, namespace),
          originalName: tool.name,
          serverId,
          namespace,
          description: tool.description,
          inputSchema: tool.inputSchema as object
        };

        if (this.config.settings?.enableToolConflictResolution && this.tools.has(aggregatedTool.name)) {
          const conflictedName = `${aggregatedTool.name}_${serverId}`;
          this.logger.warn(`Tool name conflict for '${aggregatedTool.name}', renaming to '${conflictedName}'`);
          aggregatedTool.name = conflictedName;
        }

        this.tools.set(aggregatedTool.name, aggregatedTool);
      }

      this.logger.debug(`Collected ${response.tools?.length || 0} tools from server ${serverId}`);
    } catch (error) {
      this.logger.error(`Failed to collect tools from server ${serverId}: ${error}`);
    }
  }

  private async collectResources(serverId: string, connection: ServerConnection): Promise<void> {
    if (!connection.capabilities?.resources) {
      return;
    }

    try {
      const response = await connection.client!.listResources();
      const namespace = connection.config.namespace;

      for (const resource of response.resources || []) {
        const aggregatedResource: AggregatedResource = {
          uri: this.getUriWithNamespace(resource.uri, namespace),
          originalUri: resource.uri,
          serverId,
          namespace,
          name: resource.name,
          description: resource.description,
          mimeType: resource.mimeType
        };

        if (this.config.settings?.enableResourceConflictResolution && this.resources.has(aggregatedResource.uri)) {
          const conflictedUri = `${aggregatedResource.uri}_${serverId}`;
          this.logger.warn(`Resource URI conflict for '${aggregatedResource.uri}', renaming to '${conflictedUri}'`);
          aggregatedResource.uri = conflictedUri;
        }

        this.resources.set(aggregatedResource.uri, aggregatedResource);
      }

      this.logger.debug(`Collected ${response.resources?.length || 0} resources from server ${serverId}`);
    } catch (error) {
      this.logger.error(`Failed to collect resources from server ${serverId}: ${error}`);
    }
  }

  private async collectPrompts(serverId: string, connection: ServerConnection): Promise<void> {
    if (!connection.capabilities?.prompts) {
      return;
    }

    try {
      const response = await connection.client!.listPrompts();
      const namespace = connection.config.namespace;

      for (const prompt of response.prompts || []) {
        const aggregatedPrompt: AggregatedPrompt = {
          name: this.getNameWithNamespace(prompt.name, namespace),
          originalName: prompt.name,
          serverId,
          namespace,
          description: prompt.description,
          arguments: prompt.arguments
        };

        if (this.config.settings?.enablePromptConflictResolution && this.prompts.has(aggregatedPrompt.name)) {
          const conflictedName = `${aggregatedPrompt.name}_${serverId}`;
          this.logger.warn(`Prompt name conflict for '${aggregatedPrompt.name}', renaming to '${conflictedName}'`);
          aggregatedPrompt.name = conflictedName;
        }

        this.prompts.set(aggregatedPrompt.name, aggregatedPrompt);
      }

      this.logger.debug(`Collected ${response.prompts?.length || 0} prompts from server ${serverId}`);
    } catch (error) {
      this.logger.error(`Failed to collect prompts from server ${serverId}: ${error}`);
    }
  }

  private getNameWithNamespace(name: string, namespace?: string): string {
    if (!namespace) {
      return name;
    }
    return `${namespace}:${name}`;
  }

  private getUriWithNamespace(uri: string, namespace?: string): string {
    if (!namespace) {
      return uri;
    }
    try {
      const url = new URL(uri);
      url.searchParams.set('namespace', namespace);
      return url.toString();
    } catch {
      return `${namespace}:${uri}`;
    }
  }

  getTools(): AggregatedTool[] {
    return Array.from(this.tools.values());
  }

  getResources(): AggregatedResource[] {
    return Array.from(this.resources.values());
  }

  getPrompts(): AggregatedPrompt[] {
    return Array.from(this.prompts.values());
  }

  findTool(name: string): AggregatedTool | undefined {
    return this.tools.get(name);
  }

  findResource(uri: string): AggregatedResource | undefined {
    return this.resources.get(uri);
  }

  findPrompt(name: string): AggregatedPrompt | undefined {
    return this.prompts.get(name);
  }

  getStats(): {
    tools: number;
    resources: number;
    prompts: number;
    toolsByServer: Record<string, number>;
    resourcesByServer: Record<string, number>;
    promptsByServer: Record<string, number>;
  } {
    const stats = {
      tools: this.tools.size,
      resources: this.resources.size,
      prompts: this.prompts.size,
      toolsByServer: {} as Record<string, number>,
      resourcesByServer: {} as Record<string, number>,
      promptsByServer: {} as Record<string, number>
    };

    for (const tool of this.tools.values()) {
      stats.toolsByServer[tool.serverId] = (stats.toolsByServer[tool.serverId] || 0) + 1;
    }

    for (const resource of this.resources.values()) {
      stats.resourcesByServer[resource.serverId] = (stats.resourcesByServer[resource.serverId] || 0) + 1;
    }

    for (const prompt of this.prompts.values()) {
      stats.promptsByServer[prompt.serverId] = (stats.promptsByServer[prompt.serverId] || 0) + 1;
    }

    return stats;
  }
}


