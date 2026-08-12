/** Tüm HTTP çağrıları buradan geçer; hata gövdesi Error.message'a çevrilir. */
async function istek(yol, secenekler = {}) {
  const yanit = await fetch(yol, {
    ...secenekler,
    headers: { 'content-type': 'application/json', ...(secenekler.headers ?? {}) },
  });

  if (!yanit.ok) {
    let mesaj = `${yanit.status} ${yanit.statusText}`;
    try {
      const govde = await yanit.json();
      if (govde && govde.hata) mesaj = govde.hata;
    } catch {
      // gövde JSON değilse durum metni yeterli
    }
    const hata = new Error(mesaj);
    hata.durumKodu = yanit.status;
    throw hata;
  }

  if (yanit.status === 204) return null;
  const tur = yanit.headers.get('content-type') ?? '';
  return tur.includes('application/json') ? yanit.json() : yanit.text();
}

export const api = {
  projeler: () => istek('/api/projeler'),
  proje: (id) => istek(`/api/projeler/${id}`),
  projeOlustur: (ad) =>
    istek('/api/projeler', { method: 'POST', body: JSON.stringify({ ad }) }),
  projeKaydet: (id, proje) =>
    istek(`/api/projeler/${id}`, { method: 'PUT', body: JSON.stringify(proje) }),
  projeSil: (id, gorselleriSil) =>
    istek(`/api/projeler/${id}${gorselleriSil ? '?gorselleriSil=1' : ''}`, { method: 'DELETE' }),
  onizleme: (id, basePrompt, satirlar) =>
    istek(`/api/projeler/${id}/onizleme`, {
      method: 'POST',
      body: JSON.stringify({ basePrompt, satirlar }),
    }),
  galeri: (id) => istek(`/api/projeler/${id}/galeri`),
  klasoruAc: (id) => istek(`/api/projeler/${id}/klasoru-ac`, { method: 'POST' }),

  is: () => istek('/api/is'),
  isBaslat: (projeId) =>
    istek('/api/is/baslat', { method: 'POST', body: JSON.stringify({ projeId }) }),
  isDuraklat: () => istek('/api/is/duraklat', { method: 'POST' }),
  isDevam: () => istek('/api/is/devam', { method: 'POST' }),
  isDurdur: () => istek('/api/is/durdur', { method: 'POST' }),
  kullaniciHazir: () => istek('/api/is/kullanici-hazir', { method: 'POST' }),

  tarayici: () => istek('/api/tarayici'),
  tarayiciAc: () => istek('/api/tarayici/ac', { method: 'POST' }),

  // CSV ayrıştırma sunucuda; tarayıcıda ikinci bir ayrıştırıcı tutulmuyor
  csvAyristir: (icerik) =>
    istek('/api/csv/ayristir', { method: 'POST', body: JSON.stringify({ icerik }) }),
};

/** Görsel URL'si — <img src> için. */
export function gorselUrl(projeId, dosyaAdi) {
  return `/api/projeler/${projeId}/gorsel/${encodeURIComponent(dosyaAdi)}`;
}
