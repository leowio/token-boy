declare module "petite-vue" {
  export function reactive<T extends object>(target: T): T;
  export function createApp(scope?: object): {
    mount: (target?: string | Element) => void;
  };
}
