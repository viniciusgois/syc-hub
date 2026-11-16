/** Links da empresa (site, Instagram, Google) a partir do que foi digitado no cadastro */

const hasScheme = (v: string) => /^https?:\/\//i.test(v);
/** Parece um endereço (sem espaços e com ponto), e não um nome */
const looksLikeUrl = (v: string) => hasScheme(v) || (!/\s/.test(v) && /\.[a-z]{2,}/i.test(v));

export const siteHref = (v: string) => (hasScheme(v) ? v : `https://${v}`);

/** Texto curto para exibir o site: sem "https://", "www." e barra final */
export const siteLabel = (v: string) => v.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');

export const instagramHandle = (v: string) => v.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').split(/[/?#]/)[0];
export const instagramHref = (v: string) => `https://www.instagram.com/${instagramHandle(v)}/`;

/** Link do perfil no Google; se for só o nome, abre a busca do Google */
export const googleHref = (v: string) => (looksLikeUrl(v) ? siteHref(v) : `https://www.google.com/search?q=${encodeURIComponent(v)}`);
