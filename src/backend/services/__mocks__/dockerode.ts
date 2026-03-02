// Reset containers state on each instance creation
let containers: Record<string, any> = {};

class DockerClass {
  constructor() {
    this.containers = containers;
  }
  
  // Method to reset state for testing
  static reset() {
    containers = {};
  }
  
  ping() {
    return Promise.resolve();
  }
  
  getContainer(idOrName) {
    const containerId = Object.keys(this.containers).find(
      (key) => key === idOrName || this.containers[key].name === idOrName
    );
    
    if (!containerId && !idOrName.startsWith('abc123')) {
      const error: any = new Error(`No such container: ${idOrName}`);
      error.statusCode = 404;
      throw error;
    }
    
    return {
      id: containerId || 'abc123def456',
      name: idOrName,
      
      inspect: async () => {
        if (!containerId && !idOrName.startsWith('abc123')) {
          const error: any = new Error(`No such container: ${idOrName}`);
          error.statusCode = 404;
          throw error;
        }
        return {
          Id: 'abc123def456',
          Name: '/' + (containerId ? this.containers[containerId].name : idOrName),
          State: {
            Status: containerId ? this.containers[containerId].status : 'running',
          },
        };
      },
      
      start: async () => {
        if (!containerId) {
          const error: any = new Error(`No such container: ${idOrName}`);
          error.statusCode = 404;
          throw error;
        }
        this.containers[containerId].status = 'running';
      },
      
      stop: async () => {
        if (!containerId) {
          const error: any = new Error(`No such container: ${idOrName}`);
          error.statusCode = 404;
          throw error;
        }
        this.containers[containerId].status = 'stopped';
      },
      
      remove: async ({ force } = {}) => {
        if (!containerId) {
          const error: any = new Error(`No such container: ${idOrName}`);
          error.statusCode = 404;
          throw error;
        }
        delete this.containers[containerId];
      },
      
      logs: async () => Buffer.from('Container logs here'),
      
      exec: () => ({
        start: async () => {},
      }),
    };
  }
  
  createContainer(options) {
    // Check if container with same name already exists
    const existingContainerId = Object.keys(this.containers).find(
      (key) => this.containers[key].name === options.name
    );
    
    if (existingContainerId) {
      const error: any = new Error(`Container ${options.name} already exists`);
      error.statusCode = 409;
      throw error;
    }
    
    const containerId = 'abc123def456';
    this.containers[containerId] = {
      id: containerId,
      name: options.name || 'unnamed',
      status: 'running',
      image: options.image,
    };
    
    return {
      id: containerId,
      name: options.name,
      
      inspect: async () => ({
        Id: containerId,
        Name: '/' + (options.name || 'unnamed'),
        State: {
          Status: 'running',
        },
      }),
      
      start: async () => {
        this.containers[containerId].status = 'running';
      },
    };
  }
  
  pull() {
    return Promise.resolve();
  }
  
  listContainers({ all } = {}) {
    return Promise.resolve(Object.values(this.containers).map((c: any) => ({
      Id: c.id,
      Names: ['/' + c.name],
      State: c.status,
    })));
  }
}

export default DockerClass;