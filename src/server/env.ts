// Settings read from the environment. Each is read when first used, so a
// build or a test that never touches the database does not need its address.

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value === "" ? undefined : value;
}

function flag(name: string): boolean {
  return process.env[name] === "true";
}

export const env = {
  get databaseUrl(): string {
    return required("DATABASE_URL");
  },

  /** The public address of the site, without a trailing slash. Fixed when the site is built. */
  get siteUrl(): string {
    return (process.env.SITE_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
  },

  /** The commit this build was made from. */
  get release(): string {
    return process.env.RELEASE ?? "dev";
  },

  /** Search engines are asked not to list the site unless this is switched on. */
  get allowIndexing(): boolean {
    return flag("ALLOW_INDEXING");
  },

  get databasePoolSize(): number {
    return Number(process.env.DATABASE_POOL ?? 5);
  },

  /** Signs private links and the addresses M-Pesa answers on. */
  get appSecret(): string {
    const secret = required("APP_SECRET");
    if (secret.length < 32) {
      throw new Error("APP_SECRET must be at least 32 characters");
    }
    return secret;
  },

  /** Safaricom's Daraja API. Absent when M-Pesa has not been set up. */
  get daraja(): {
    production: boolean;
    consumerKey: string;
    consumerSecret: string;
    shortcode: string;
    passkey: string;
  } | null {
    const consumerKey = optional("DARAJA_CONSUMER_KEY");
    const consumerSecret = optional("DARAJA_CONSUMER_SECRET");
    const shortcode = optional("DARAJA_SHORTCODE");
    const passkey = optional("DARAJA_PASSKEY");
    if (!consumerKey || !consumerSecret || !shortcode || !passkey) return null;
    return { production: optional("DARAJA_ENV") === "production", consumerKey, consumerSecret, shortcode, passkey };
  },

  /**
   * When set, every M-Pesa prompt asks for this many shillings whatever is
   * owed, and the payment still counts in full. Used where the prompt goes
   * through Safaricom's test system.
   */
  get mpesaPromptShillings(): number | null {
    const value = Number(optional("MPESA_PROMPT_SHILLINGS"));
    return Number.isInteger(value) && value > 0 ? value : null;
  },

  /** Lets a booking be completed with a payment that moves no money. */
  get testPayments(): boolean {
    return flag("TEST_PAYMENTS");
  },

  /** Resend's API key. Without it, messages are written and kept but not sent. */
  get resendKey(): string | undefined {
    return optional("RESEND_API_KEY");
  },

  /** "Ukingo <ukingo@example.com>" */
  get mailFrom(): string {
    return optional("MAIL_FROM") ?? "Ukingo <ukingo@jeffgicharu.com>";
  },

  /** The most emails sent in one day, to everyone and to any one address or visitor. */
  get mailLimits(): { daily: number; perAddress: number; perVisitor: number } {
    return {
      daily: Number(optional("MAIL_DAILY_LIMIT") ?? 40),
      perAddress: Number(optional("MAIL_ADDRESS_LIMIT") ?? 8),
      perVisitor: Number(optional("MAIL_VISITOR_LIMIT") ?? 10),
    };
  },

  /** Where the nightly backup leaves its dumps and the note of its last restore check. */
  get backupDir(): string | undefined {
    return optional("BACKUP_DIR");
  },

  /**
   * Where photographs put up from the back office are kept. Outside any one
   * release, so they outlive it. A development copy keeps them in uploads/.
   */
  get mediaDir(): string | undefined {
    return optional("MEDIA_DIR") ?? (process.env.NODE_ENV === "production" ? undefined : "uploads");
  },

  /** Where trouble is reported. */
  get alertEmail(): string | undefined {
    return optional("ALERT_EMAIL");
  },

  /** Staff accounts for training are offered, and the sample data is rebuilt every night. */
  get training(): boolean {
    return flag("TRAINING_MODE");
  },

  /**
   * What a link must carry to sign someone in to a training account. The
   * links are handed out by whoever runs the training, and work for nobody
   * who has not been given one.
   */
  get trainingKey(): string | undefined {
    const key = optional("TRAINING_KEY");
    return key && key.length >= 16 ? key : undefined;
  },
};
