export interface PDReport {
  timestamp_us: number
  recv_counter: number
  drop_count?: number
  vbus_mv: number
  ibus_ma?: number
  cc1_mv: number
  cc2_mv: number
  dp_mv?: number
  dm_mv?: number
  event_type: number
  active_cc: number
  pd_data_len: number
  pd_raw: number[]
}

export interface PowerSample {
  timestamp_us: number
  recv_counter: number
  vbus_mv: number
  ibus_ma: number
  cc1_mv: number
  cc2_mv: number
  dp_mv: number
  dm_mv: number
  active_cc: number
  event_type: number
}
