import { Kit, type KitInfo } from "./kit";

export const AXIOS_KIT_ID = "axios";

const AXIOS_KIT_INFO: KitInfo = {
	id: AXIOS_KIT_ID,
	name: "AxiosKit",
	category: "network",
	description: "Manage Axios instances and static registry.",
	tags: ["http", "request", "axios"],
};

export class AxiosKit extends Kit {
	constructor() {
		super(AXIOS_KIT_INFO);
	}
}
