interface OpenMeteoForecast {
  current?: { temperature_2m?: number };
  current_units?: { temperature_2m?: string };
}

/**
 * Flattens Open-Meteo's current-weather response into a compact shape the LLM
 * can phrase directly: { temperature, unit }. Throws if the temperature field
 * is missing so the executor surfaces a clear { error } to the LLM.
 */
export default function transform(data: unknown): unknown {
  const forecast = data as OpenMeteoForecast;
  const temperature = forecast.current?.temperature_2m;
  if (typeof temperature !== 'number') {
    throw new Error('Open-Meteo response missing current.temperature_2m');
  }
  return {
    temperature,
    unit: forecast.current_units?.temperature_2m ?? '°C',
  };
}
