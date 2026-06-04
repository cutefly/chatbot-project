interface GeoNamesCity {
  name: string;
  population: number;
  countryName: string;
  adminName1?: string;
}

interface GeoNamesResponse {
  geonames?: GeoNamesCity[];
  status?: { message: string; value: number };
}

export default function transform(data: unknown): unknown {
  const body = data as GeoNamesResponse;

  if (body.status) {
    throw new Error(`GeoNames API error: ${body.status.message}`);
  }

  const cities = body.geonames ?? [];
  if (cities.length === 0) {
    throw new Error('No cities found for the given country code');
  }

  return {
    country: cities[0].countryName,
    cities: cities.map((c) => c.name),
  };
}
