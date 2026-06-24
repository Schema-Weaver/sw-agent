import { AuditEvent } from './types';

export interface CloudWriterConfig {
  enabled: boolean;
  url?: string;
  agent_token: string;
}

export interface CloudWriterResult {
  status: 'disabled' | 'not_configured' | 'not_implemented' | 'ok';
}

export class CloudAuditWriter {
  private readonly config: CloudWriterConfig;
  private warnedNotConfigured = false;
  private warnedNotImplemented = false;

  constructor(config: CloudWriterConfig) {
    this.config = config;
  }

  async log(_event: AuditEvent): Promise<CloudWriterResult> {
    if (!this.config.enabled) {
      return { status: 'disabled' };
    }
    
    if (!this.config.url) {
      if (!this.warnedNotConfigured) {
        console.warn('[audit] Cloud audit enabled but no URL configured');
        this.warnedNotConfigured = true;
      }
      return { status: 'not_configured' };
    }
    
    if (!this.warnedNotImplemented) {
      console.warn('[audit] Cloud audit not implemented yet (URL configured but upload is stub)');
      this.warnedNotImplemented = true;
    }
    return { status: 'not_implemented' };
  }
}
