declare module "petite-vue" {
  export function createApp(scope?: object): {
    mount: (target?: string | Element) => void;
  };
}
