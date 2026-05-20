import { env } from '$env/dynamic/private';

const DEFAULT_BACKEND_URL = 'http://localhost:8080';

export function backendUrl(path: string): string {
	const base = (env.BACKEND_URL ?? DEFAULT_BACKEND_URL).replace(/\/+$/, '');
	const suffix = path.startsWith('/') ? path : `/${path}`;
	return `${base}${suffix}`;
}
