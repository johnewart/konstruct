export type AppContext = {
  projectRoot: string;
};

export const createContext = (): AppContext => {
  const projectRoot = process.env.PROJECT_ROOT ?? process.cwd();
  return { projectRoot };
};

export type Context = Awaited<ReturnType<typeof createContext>>;
