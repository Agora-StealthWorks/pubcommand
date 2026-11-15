export type SsoProvider = {
  id: string;
  name: string;
};

export type SsoIdentity = {
  email: string;
  subject: string;
};

/**
 * SSO hooks only. Phase 1 does not register a provider or complete a login.
 * A later phase can supply startLogin and completeLogin per organization.
 */
export interface SsoHooks {
  listProviders(organizationId: string): Promise<SsoProvider[]>;
  startLogin?(input: {
    providerId: string;
    organizationId: string;
    redirectTo: string;
  }): Promise<{ redirectUrl: string }>;
  completeLogin?(input: {
    providerId: string;
    organizationId: string;
    callbackParams: Record<string, string>;
  }): Promise<SsoIdentity>;
}

export const ssoNotConfigured: SsoHooks = {
  async listProviders() {
    return [];
  },
};
