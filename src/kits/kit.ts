export type KitInfo = {
	id: string;
	name: string;
	category?: string;
	description?: string;
	tags?: readonly string[];
};

export type KitLifecycleContext = {
	activityId?: string;
	reason?: string;
};

export abstract class Kit {
	private active = false;

	protected constructor(public readonly info: KitInfo) {}

	get id(): string {
		return this.info.id;
	}

	isActive(): boolean {
		return this.active;
	}

	async start(context: KitLifecycleContext = {}): Promise<void> {
		if (this.active) {
			return;
		}

		await this.onStart(context);
		this.active = true;
	}

	async stop(context: KitLifecycleContext = {}): Promise<void> {
		if (!this.active) {
			return;
		}

		try {
			await this.onStop(context);
		} finally {
			this.active = false;
		}
	}

	protected async onStart(_context: KitLifecycleContext): Promise<void> {}

	protected async onStop(_context: KitLifecycleContext): Promise<void> {}
}