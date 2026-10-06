//+------------------------------------------------------------------+
//|                                     TradeSpaceCopierFilter.mqh   |
//|                 TradeSpace Institutional Multi-Account Decoder   |
//|                                  Copyright 2026, TradeSpace Org  |
//+------------------------------------------------------------------+
#property copyright "TradeSpace Org"
#property link      "https://tradespace.internal"
#property version   "2.00"
#property strict

//+------------------------------------------------------------------+
//| Structural Enums for TradeSpace Dimensions                       |
//+------------------------------------------------------------------+
enum ENUM_TS_ASSET_CLASS
  {
   TS_ASSET_UNKNOWN   = 0,
   TS_ASSET_INDEX     = 1, // NAS100, US30, DJ30, SP500, GER40, UK100
   TS_ASSET_METAL     = 2, // XAUUSD, XAGUSD
   TS_ASSET_CRYPTO    = 3, // BTCUSD, ETHUSD
   TS_ASSET_FX_MAJOR  = 4, // EURUSD, GBPUSD, USDJPY, AUDUSD, USDCAD
   TS_ASSET_FX_CROSS  = 5, // EURGBP, GBPAUD, etc.
   TS_ASSET_OTHER     = 9
  };

enum ENUM_TS_HORIZON
  {
   TS_HORIZON_UNKNOWN  = 0,
   TS_HORIZON_SWING    = 1, // 1D-1H Swing
   TS_HORIZON_DAY      = 2, // 4H-15M Day Trade
   TS_HORIZON_SCALP    = 3, // 15M-1M Scalp
   TS_HORIZON_OTHER    = 9
  };

enum ENUM_TS_MODEL
  {
   TS_MODEL_UNKNOWN        = 0,
   TS_MODEL_ICT_2022       = 1, // Sweep + MSS + FVG CE
   TS_MODEL_TURTLE_SOUP    = 2, // External Raid & Rapid Reclaim
   TS_MODEL_BREAKER_BLOCK  = 3, // Breaker Block & Mitigation Retest
   TS_MODEL_OTE            = 4, // Optimal Trade Entry (.62-.79 Fib)
   TS_MODEL_SILVER_BULLET  = 5, // Session Silver Bullet Window
   TS_MODEL_OTHER          = 9
  };

enum ENUM_TS_MANAGEMENT
  {
   TS_MGT_UNKNOWN          = 0,
   TS_MGT_MILESTONE_50     = 1, // 40% booked at 50% target milestone, SL to BE, 60% runner
   TS_MGT_PROP_FIRM_SAFE   = 2, // 1.5R-2.5R TP; SL to -0.5R at 1.0R; SL to BE at 1.5R
   TS_MGT_OTHER            = 9
  };

//+------------------------------------------------------------------+
//| Decoded TradeSpace Magic Structure                               |
//+------------------------------------------------------------------+
struct TradeSpaceMagicDecoded
  {
   ulong                rawMagic;
   int                  prefix;        // 23 = TradeSpace
   bool                 isTradeSpace;
   ENUM_TS_ASSET_CLASS  assetClass;
   ENUM_TS_HORIZON      horizon;
   ENUM_TS_MODEL        model;
   ENUM_TS_MANAGEMENT   management;
   int                  accountTier;   // 00=Universal, 01=FTMO, 02=FundedNext, etc.
   string               description;
  };

//+------------------------------------------------------------------+
//| Decode an 8-digit Decimal Magic Number (PP A H M L RR)           |
//+------------------------------------------------------------------+
TradeSpaceMagicDecoded DecodeTradeSpaceMagic(const ulong magic)
  {
   TradeSpaceMagicDecoded res;
   res.rawMagic     = magic;
   res.isTradeSpace = false;
   res.prefix       = 0;
   res.assetClass   = TS_ASSET_UNKNOWN;
   res.horizon      = TS_HORIZON_UNKNOWN;
   res.model        = TS_MODEL_UNKNOWN;
   res.management   = TS_MGT_UNKNOWN;
   res.accountTier  = 0;
   res.description  = "Not a TradeSpace Magic Number";

   if(magic < 10000000 || magic > 99999999)
      return res;

   int p = (int)(magic / 1000000);
   int a = (int)((magic % 1000000) / 100000);
   int h = (int)((magic % 100000) / 10000);
   int m = (int)((magic % 10000) / 1000);
   int l = (int)((magic % 1000) / 100);
   int r = (int)(magic % 100);

   res.prefix      = p;
   res.isTradeSpace= (p == 23);
   res.accountTier = r;

   // Map Asset Class
   switch(a)
     {
      case 1: res.assetClass = TS_ASSET_INDEX; break;
      case 2: res.assetClass = TS_ASSET_METAL; break;
      case 3: res.assetClass = TS_ASSET_CRYPTO; break;
      case 4: res.assetClass = TS_ASSET_FX_MAJOR; break;
      case 5: res.assetClass = TS_ASSET_FX_CROSS; break;
      default: res.assetClass = TS_ASSET_OTHER; break;
     }

   // Map Horizon
   switch(h)
     {
      case 1: res.horizon = TS_HORIZON_SWING; break;
      case 2: res.horizon = TS_HORIZON_DAY; break;
      case 3: res.horizon = TS_HORIZON_SCALP; break;
      default: res.horizon = TS_HORIZON_OTHER; break;
     }

   // Map Model
   switch(m)
     {
      case 1: res.model = TS_MODEL_ICT_2022; break;
      case 2: res.model = TS_MODEL_TURTLE_SOUP; break;
      case 3: res.model = TS_MODEL_BREAKER_BLOCK; break;
      case 4: res.model = TS_MODEL_OTE; break;
      case 5: res.model = TS_MODEL_SILVER_BULLET; break;
      default: res.model = TS_MODEL_OTHER; break;
     }

   // Map Management (Official 2 Modes: Milestone 50 = 1, Prop-Firm Safe = 2)
   switch(l)
     {
      case 1: res.management = TS_MGT_MILESTONE_50; break;
      case 2: res.management = TS_MGT_PROP_FIRM_SAFE; break;
      default: res.management = TS_MGT_OTHER; break;
     }

   res.description = StringFormat("Prefix:%d Asset:%d Horizon:%d Model:%d Mgt:%d Tier:%02d",
                                  p, a, h, m, l, r);
   return res;
  }

//+------------------------------------------------------------------+
//| Filter Predicate for Receiver / Slave Copier EA                 |
//| Return true if the slave account should copy this trade.         |
//+------------------------------------------------------------------+
bool IsTradeEligibleForReceiver(const ulong magic,
                               const string comment,
                               const int targetTierFilter,       // 0 = Accept all tiers, or 1, 2, 3...
                               const bool allowIndices,
                               const bool allowMetals,
                               const bool allowCrypto,
                               const bool allowForex,
                               const bool allowSwing,
                               const bool allowDay,
                               const bool allowScalp,
                               const ENUM_TS_MANAGEMENT requiredManagement = TS_MGT_UNKNOWN)
  {
   TradeSpaceMagicDecoded dec = DecodeTradeSpaceMagic(magic);

   // Fallback check on Comment if magic is standard
   if(!dec.isTradeSpace)
     {
      if(StringFind(comment, "TS:") == 0)
        {
         // TradeSpace comment prefix detected, proceed with basic checks
         return true;
        }
      return false;
     }

   // 1. Account Tier check (if targetTierFilter is set)
   if(targetTierFilter > 0 && dec.accountTier != 0 && dec.accountTier != targetTierFilter)
      return false;

   // 2. Asset Class Filter
   if(dec.assetClass == TS_ASSET_INDEX && !allowIndices) return false;
   if(dec.assetClass == TS_ASSET_METAL && !allowMetals) return false;
   if(dec.assetClass == TS_ASSET_CRYPTO && !allowCrypto) return false;
   if((dec.assetClass == TS_ASSET_FX_MAJOR || dec.assetClass == TS_ASSET_FX_CROSS) && !allowForex) return false;

   // 3. Horizon Filter (Official 3 Horizons: Swing 1, Day 2, Scalp 3)
   if(dec.horizon == TS_HORIZON_SWING && !allowSwing) return false;
   if(dec.horizon == TS_HORIZON_DAY && !allowDay) return false;
   if(dec.horizon == TS_HORIZON_SCALP && !allowScalp) return false;

   // 4. Trade Management Logic Filter
   if(requiredManagement != TS_MGT_UNKNOWN && dec.management != requiredManagement)
      return false;

   return true;
  }
