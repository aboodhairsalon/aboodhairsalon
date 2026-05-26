export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.5';
  };
  public: {
    Tables: {
      audit_log: {
        Row: {
          actor_id: string | null;
          at: string;
          diff: Json | null;
          id: number;
          operation: string;
          row_id: string;
          table_name: string;
          tenant_id: string | null;
        };
        Insert: {
          actor_id?: string | null;
          at?: string;
          diff?: Json | null;
          id?: number;
          operation: string;
          row_id: string;
          table_name: string;
          tenant_id?: string | null;
        };
        Update: {
          actor_id?: string | null;
          at?: string;
          diff?: Json | null;
          id?: number;
          operation?: string;
          row_id?: string;
          table_name?: string;
          tenant_id?: string | null;
        };
        Relationships: [];
      };
      barber_reviews: {
        Row: {
          barber_id: string;
          booking_id: string | null;
          client_phone: string;
          comment: string | null;
          created_at: string;
          id: string;
          rating: number;
          sale_id: string | null;
          tenant_id: string;
        };
        Insert: {
          barber_id: string;
          booking_id?: string | null;
          client_phone: string;
          comment?: string | null;
          created_at?: string;
          id?: string;
          rating: number;
          sale_id?: string | null;
          tenant_id: string;
        };
        Update: {
          barber_id?: string;
          booking_id?: string | null;
          client_phone?: string;
          comment?: string | null;
          created_at?: string;
          id?: string;
          rating?: number;
          sale_id?: string | null;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'barber_reviews_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'bookings';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'barber_reviews_sale_id_fkey';
            columns: ['sale_id'];
            isOneToOne: false;
            referencedRelation: 'sales';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'barber_reviews_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      barber_schedules: {
        Row: {
          barber_id: string;
          created_at: string;
          day_of_week: number;
          end_time: string;
          id: string;
          start_time: string;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          barber_id: string;
          created_at?: string;
          day_of_week: number;
          end_time: string;
          id?: string;
          start_time: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          barber_id?: string;
          created_at?: string;
          day_of_week?: number;
          end_time?: string;
          id?: string;
          start_time?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'barber_schedules_barber_id_fkey';
            columns: ['barber_id'];
            isOneToOne: false;
            referencedRelation: 'barbers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'barber_schedules_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      barber_time_off: {
        Row: {
          approved: boolean;
          barber_id: string;
          created_at: string;
          ends_at: string;
          id: string;
          kind: Database['public']['Enums']['time_off_kind'];
          reason: string | null;
          starts_at: string;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          approved?: boolean;
          barber_id: string;
          created_at?: string;
          ends_at: string;
          id?: string;
          kind?: Database['public']['Enums']['time_off_kind'];
          reason?: string | null;
          starts_at: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          approved?: boolean;
          barber_id?: string;
          created_at?: string;
          ends_at?: string;
          id?: string;
          kind?: Database['public']['Enums']['time_off_kind'];
          reason?: string | null;
          starts_at?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'barber_time_off_barber_id_fkey';
            columns: ['barber_id'];
            isOneToOne: false;
            referencedRelation: 'barbers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'barber_time_off_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      barbers: {
        Row: {
          bio: string | null;
          commission_bp: number;
          created_at: string;
          display_name: string;
          id: string;
          initials: string;
          is_active: boolean;
          location_id: string | null;
          photo_url: string | null;
          profile_id: string | null;
          role: Database['public']['Enums']['barber_role'];
          sort_order: number;
          tenant_id: string;
          tone: string;
          updated_at: string;
        };
        Insert: {
          bio?: string | null;
          commission_bp?: number;
          created_at?: string;
          display_name: string;
          id?: string;
          initials: string;
          is_active?: boolean;
          location_id?: string | null;
          photo_url?: string | null;
          profile_id?: string | null;
          role?: Database['public']['Enums']['barber_role'];
          sort_order?: number;
          tenant_id: string;
          tone?: string;
          updated_at?: string;
        };
        Update: {
          bio?: string | null;
          commission_bp?: number;
          created_at?: string;
          display_name?: string;
          id?: string;
          initials?: string;
          is_active?: boolean;
          location_id?: string | null;
          photo_url?: string | null;
          profile_id?: string | null;
          role?: Database['public']['Enums']['barber_role'];
          sort_order?: number;
          tenant_id?: string;
          tone?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'barbers_location_id_fkey';
            columns: ['location_id'];
            isOneToOne: false;
            referencedRelation: 'locations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'barbers_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'barbers_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      bookings: {
        Row: {
          amount_cents: number;
          barber_id: string | null;
          cancellation_reason: string | null;
          client_display_name: string;
          client_email: string | null;
          client_id: string | null;
          client_phone: string | null;
          created_at: string;
          deposit_cents: number;
          ends_at: string;
          extras: Json;
          id: string;
          location_id: string | null;
          notes: string | null;
          paid: boolean;
          payment_intent_id: string | null;
          reminder_sent_at: string | null;
          service_id: string;
          source: Database['public']['Enums']['booking_source'];
          starts_at: string;
          status: Database['public']['Enums']['booking_status'];
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          amount_cents: number;
          barber_id?: string | null;
          cancellation_reason?: string | null;
          client_display_name: string;
          client_email?: string | null;
          client_id?: string | null;
          client_phone?: string | null;
          created_at?: string;
          deposit_cents?: number;
          ends_at: string;
          extras?: Json;
          id?: string;
          location_id?: string | null;
          notes?: string | null;
          paid?: boolean;
          payment_intent_id?: string | null;
          reminder_sent_at?: string | null;
          service_id: string;
          source?: Database['public']['Enums']['booking_source'];
          starts_at: string;
          status?: Database['public']['Enums']['booking_status'];
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          amount_cents?: number;
          barber_id?: string | null;
          cancellation_reason?: string | null;
          client_display_name?: string;
          client_email?: string | null;
          client_id?: string | null;
          client_phone?: string | null;
          created_at?: string;
          deposit_cents?: number;
          ends_at?: string;
          extras?: Json;
          id?: string;
          location_id?: string | null;
          notes?: string | null;
          paid?: boolean;
          payment_intent_id?: string | null;
          reminder_sent_at?: string | null;
          service_id?: string;
          source?: Database['public']['Enums']['booking_source'];
          starts_at?: string;
          status?: Database['public']['Enums']['booking_status'];
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'bookings_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'clients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'bookings_location_id_fkey';
            columns: ['location_id'];
            isOneToOne: false;
            referencedRelation: 'locations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'bookings_service_id_fkey';
            columns: ['service_id'];
            isOneToOne: false;
            referencedRelation: 'services';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'bookings_staff_fkey';
            columns: ['barber_id'];
            isOneToOne: false;
            referencedRelation: 'staff';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'bookings_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      client_profiles: {
        Row: {
          cashback_redeemed_cents: number;
          created_at: string;
          date_of_birth: string | null;
          email: string | null;
          first_name: string | null;
          id: string;
          last_name: string | null;
          phone: string;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          cashback_redeemed_cents?: number;
          created_at?: string;
          date_of_birth?: string | null;
          email?: string | null;
          first_name?: string | null;
          id?: string;
          last_name?: string | null;
          phone: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          cashback_redeemed_cents?: number;
          created_at?: string;
          date_of_birth?: string | null;
          email?: string | null;
          first_name?: string | null;
          id?: string;
          last_name?: string | null;
          phone?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'client_profiles_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      client_tenant_links: {
        Row: {
          created_at: string;
          first_seen_at: string;
          id: string;
          last_seen_at: string;
          profile_id: string;
          status: Database['public']['Enums']['client_link_status'];
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          first_seen_at?: string;
          id?: string;
          last_seen_at?: string;
          profile_id: string;
          status?: Database['public']['Enums']['client_link_status'];
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          first_seen_at?: string;
          id?: string;
          last_seen_at?: string;
          profile_id?: string;
          status?: Database['public']['Enums']['client_link_status'];
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'client_tenant_links_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'client_tenant_links_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      clients: {
        Row: {
          banned: boolean;
          created_at: string;
          display_name: string;
          email: string | null;
          first_seen_at: string;
          id: string;
          last_seen_at: string;
          loyalty_points: number;
          notes: string | null;
          phone: string | null;
          profile_id: string | null;
          reliability_score: number;
          tags: string[];
          tenant_id: string;
          total_spent_cents: number;
          updated_at: string;
          visits_count: number;
        };
        Insert: {
          banned?: boolean;
          created_at?: string;
          display_name: string;
          email?: string | null;
          first_seen_at?: string;
          id?: string;
          last_seen_at?: string;
          loyalty_points?: number;
          notes?: string | null;
          phone?: string | null;
          profile_id?: string | null;
          reliability_score?: number;
          tags?: string[];
          tenant_id: string;
          total_spent_cents?: number;
          updated_at?: string;
          visits_count?: number;
        };
        Update: {
          banned?: boolean;
          created_at?: string;
          display_name?: string;
          email?: string | null;
          first_seen_at?: string;
          id?: string;
          last_seen_at?: string;
          loyalty_points?: number;
          notes?: string | null;
          phone?: string | null;
          profile_id?: string | null;
          reliability_score?: number;
          tags?: string[];
          tenant_id?: string;
          total_spent_cents?: number;
          updated_at?: string;
          visits_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'clients_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'clients_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      gift_cards: {
        Row: {
          beneficiary_email: string | null;
          beneficiary_name: string | null;
          code: string;
          created_at: string;
          expires_at: string | null;
          id: string;
          initial_value_cents: number;
          message: string | null;
          purchased_via_sale_id: string | null;
          purchaser_client_id: string | null;
          remaining_value_cents: number;
          status: Database['public']['Enums']['gift_card_status'];
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          beneficiary_email?: string | null;
          beneficiary_name?: string | null;
          code: string;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          initial_value_cents: number;
          message?: string | null;
          purchased_via_sale_id?: string | null;
          purchaser_client_id?: string | null;
          remaining_value_cents: number;
          status?: Database['public']['Enums']['gift_card_status'];
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          beneficiary_email?: string | null;
          beneficiary_name?: string | null;
          code?: string;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          initial_value_cents?: number;
          message?: string | null;
          purchased_via_sale_id?: string | null;
          purchaser_client_id?: string | null;
          remaining_value_cents?: number;
          status?: Database['public']['Enums']['gift_card_status'];
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'gift_cards_purchased_via_sale_id_fkey';
            columns: ['purchased_via_sale_id'];
            isOneToOne: false;
            referencedRelation: 'sales';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'gift_cards_purchaser_client_id_fkey';
            columns: ['purchaser_client_id'];
            isOneToOne: false;
            referencedRelation: 'clients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'gift_cards_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      locations: {
        Row: {
          address: string | null;
          business_hours: Json;
          city: string | null;
          country: string;
          created_at: string;
          email: string | null;
          id: string;
          is_primary: boolean;
          latitude: number | null;
          longitude: number | null;
          name: string;
          phone: string | null;
          tenant_id: string;
          timezone: string | null;
          updated_at: string;
          zip: string | null;
        };
        Insert: {
          address?: string | null;
          business_hours?: Json;
          city?: string | null;
          country?: string;
          created_at?: string;
          email?: string | null;
          id?: string;
          is_primary?: boolean;
          latitude?: number | null;
          longitude?: number | null;
          name: string;
          phone?: string | null;
          tenant_id: string;
          timezone?: string | null;
          updated_at?: string;
          zip?: string | null;
        };
        Update: {
          address?: string | null;
          business_hours?: Json;
          city?: string | null;
          country?: string;
          created_at?: string;
          email?: string | null;
          id?: string;
          is_primary?: boolean;
          latitude?: number | null;
          longitude?: number | null;
          name?: string;
          phone?: string | null;
          tenant_id?: string;
          timezone?: string | null;
          updated_at?: string;
          zip?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'locations_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      loyalty_balances: {
        Row: {
          client_id: string;
          created_at: string;
          delta: number;
          id: string;
          kind: Database['public']['Enums']['loyalty_event_kind'];
          reason: string | null;
          reference_id: string | null;
          tenant_id: string;
        };
        Insert: {
          client_id: string;
          created_at?: string;
          delta: number;
          id?: string;
          kind: Database['public']['Enums']['loyalty_event_kind'];
          reason?: string | null;
          reference_id?: string | null;
          tenant_id: string;
        };
        Update: {
          client_id?: string;
          created_at?: string;
          delta?: number;
          id?: string;
          kind?: Database['public']['Enums']['loyalty_event_kind'];
          reason?: string | null;
          reference_id?: string | null;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'loyalty_balances_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'clients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'loyalty_balances_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      product_movements: {
        Row: {
          actor_id: string | null;
          created_at: string;
          id: string;
          kind: Database['public']['Enums']['product_movement_kind'];
          product_id: string;
          qty_delta: number;
          reason: string | null;
          reference_id: string | null;
          tenant_id: string;
        };
        Insert: {
          actor_id?: string | null;
          created_at?: string;
          id?: string;
          kind: Database['public']['Enums']['product_movement_kind'];
          product_id: string;
          qty_delta: number;
          reason?: string | null;
          reference_id?: string | null;
          tenant_id: string;
        };
        Update: {
          actor_id?: string | null;
          created_at?: string;
          id?: string;
          kind?: Database['public']['Enums']['product_movement_kind'];
          product_id?: string;
          qty_delta?: number;
          reason?: string | null;
          reference_id?: string | null;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'product_movements_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'product_movements_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      products: {
        Row: {
          cost_cents: number | null;
          created_at: string;
          description: string | null;
          id: string;
          image_url: string | null;
          is_active: boolean;
          low_threshold: number;
          name: string;
          price_cents: number;
          sku: string;
          stock: number;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          cost_cents?: number | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          image_url?: string | null;
          is_active?: boolean;
          low_threshold?: number;
          name: string;
          price_cents: number;
          sku: string;
          stock?: number;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          cost_cents?: number | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          image_url?: string | null;
          is_active?: boolean;
          low_threshold?: number;
          name?: string;
          price_cents?: number;
          sku?: string;
          stock?: number;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'products_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          email: string;
          full_name: string | null;
          id: string;
          locale: string;
          marketing_opt_in: boolean;
          phone: string | null;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          email: string;
          full_name?: string | null;
          id: string;
          locale?: string;
          marketing_opt_in?: boolean;
          phone?: string | null;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          email?: string;
          full_name?: string | null;
          id?: string;
          locale?: string;
          marketing_opt_in?: boolean;
          phone?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          auth: string;
          created_at: string;
          endpoint: string;
          id: string;
          last_used_at: string | null;
          p256dh: string;
          role: string;
          tenant_id: string;
          user_agent: string | null;
          user_id: string;
        };
        Insert: {
          auth: string;
          created_at?: string;
          endpoint: string;
          id?: string;
          last_used_at?: string | null;
          p256dh: string;
          role: string;
          tenant_id: string;
          user_agent?: string | null;
          user_id: string;
        };
        Update: {
          auth?: string;
          created_at?: string;
          endpoint?: string;
          id?: string;
          last_used_at?: string | null;
          p256dh?: string;
          role?: string;
          tenant_id?: string;
          user_agent?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'push_subscriptions_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      reviews: {
        Row: {
          barber_id: string | null;
          booking_id: string;
          client_id: string | null;
          comment: string | null;
          created_at: string;
          id: string;
          is_public: boolean;
          rating: number;
          responded_at: string | null;
          response: string | null;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          barber_id?: string | null;
          booking_id: string;
          client_id?: string | null;
          comment?: string | null;
          created_at?: string;
          id?: string;
          is_public?: boolean;
          rating: number;
          responded_at?: string | null;
          response?: string | null;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          barber_id?: string | null;
          booking_id?: string;
          client_id?: string | null;
          comment?: string | null;
          created_at?: string;
          id?: string;
          is_public?: boolean;
          rating?: number;
          responded_at?: string | null;
          response?: string | null;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'reviews_barber_id_fkey';
            columns: ['barber_id'];
            isOneToOne: false;
            referencedRelation: 'barbers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reviews_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: true;
            referencedRelation: 'bookings';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reviews_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'clients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'reviews_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      sale_items: {
        Row: {
          created_at: string;
          id: string;
          kind: Database['public']['Enums']['sale_item_kind'];
          name: string;
          product_id: string | null;
          qty: number;
          sale_id: string;
          service_id: string | null;
          tenant_id: string;
          total_cents: number;
          unit_price_cents: number;
        };
        Insert: {
          created_at?: string;
          id?: string;
          kind: Database['public']['Enums']['sale_item_kind'];
          name: string;
          product_id?: string | null;
          qty?: number;
          sale_id: string;
          service_id?: string | null;
          tenant_id: string;
          total_cents: number;
          unit_price_cents: number;
        };
        Update: {
          created_at?: string;
          id?: string;
          kind?: Database['public']['Enums']['sale_item_kind'];
          name?: string;
          product_id?: string | null;
          qty?: number;
          sale_id?: string;
          service_id?: string | null;
          tenant_id?: string;
          total_cents?: number;
          unit_price_cents?: number;
        };
        Relationships: [
          {
            foreignKeyName: 'sale_items_product_id_fkey';
            columns: ['product_id'];
            isOneToOne: false;
            referencedRelation: 'products';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'sale_items_sale_id_fkey';
            columns: ['sale_id'];
            isOneToOne: false;
            referencedRelation: 'sales';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'sale_items_service_id_fkey';
            columns: ['service_id'];
            isOneToOne: false;
            referencedRelation: 'services';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'sale_items_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      sales: {
        Row: {
          barber_id: string | null;
          booking_id: string | null;
          cashback_redeemed_cents: number;
          cashier_id: string | null;
          client_id: string | null;
          client_name: string | null;
          client_phone: string | null;
          completed_at: string | null;
          created_at: string;
          discount_cents: number;
          id: string;
          location_id: string | null;
          method: Database['public']['Enums']['sale_method'];
          notes: string | null;
          offline_client_id: string | null;
          payment_intent_id: string | null;
          receipt_email_sent: boolean;
          refund_reason: string | null;
          refunded_at: string | null;
          refunded_by: string | null;
          refunded_cents: number;
          status: Database['public']['Enums']['sale_status'];
          subtotal_cents: number;
          tax_cents: number;
          tenant_id: string;
          tip_cents: number;
          total_cents: number;
          updated_at: string;
        };
        Insert: {
          barber_id?: string | null;
          booking_id?: string | null;
          cashback_redeemed_cents?: number;
          cashier_id?: string | null;
          client_id?: string | null;
          client_name?: string | null;
          client_phone?: string | null;
          completed_at?: string | null;
          created_at?: string;
          discount_cents?: number;
          id?: string;
          location_id?: string | null;
          method: Database['public']['Enums']['sale_method'];
          notes?: string | null;
          offline_client_id?: string | null;
          payment_intent_id?: string | null;
          receipt_email_sent?: boolean;
          refund_reason?: string | null;
          refunded_at?: string | null;
          refunded_by?: string | null;
          refunded_cents?: number;
          status?: Database['public']['Enums']['sale_status'];
          subtotal_cents: number;
          tax_cents?: number;
          tenant_id: string;
          tip_cents?: number;
          total_cents: number;
          updated_at?: string;
        };
        Update: {
          barber_id?: string | null;
          booking_id?: string | null;
          cashback_redeemed_cents?: number;
          cashier_id?: string | null;
          client_id?: string | null;
          client_name?: string | null;
          client_phone?: string | null;
          completed_at?: string | null;
          created_at?: string;
          discount_cents?: number;
          id?: string;
          location_id?: string | null;
          method?: Database['public']['Enums']['sale_method'];
          notes?: string | null;
          offline_client_id?: string | null;
          payment_intent_id?: string | null;
          receipt_email_sent?: boolean;
          refund_reason?: string | null;
          refunded_at?: string | null;
          refunded_by?: string | null;
          refunded_cents?: number;
          status?: Database['public']['Enums']['sale_status'];
          subtotal_cents?: number;
          tax_cents?: number;
          tenant_id?: string;
          tip_cents?: number;
          total_cents?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'sales_booking_id_fkey';
            columns: ['booking_id'];
            isOneToOne: false;
            referencedRelation: 'bookings';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'sales_client_id_fkey';
            columns: ['client_id'];
            isOneToOne: false;
            referencedRelation: 'clients';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'sales_location_id_fkey';
            columns: ['location_id'];
            isOneToOne: false;
            referencedRelation: 'locations';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'sales_staff_fkey';
            columns: ['barber_id'];
            isOneToOne: false;
            referencedRelation: 'staff';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'sales_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      service_barbers: {
        Row: {
          barber_id: string;
          created_at: string;
          service_id: string;
          tenant_id: string;
        };
        Insert: {
          barber_id: string;
          created_at?: string;
          service_id: string;
          tenant_id: string;
        };
        Update: {
          barber_id?: string;
          created_at?: string;
          service_id?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'service_barbers_barber_id_fkey';
            columns: ['barber_id'];
            isOneToOne: false;
            referencedRelation: 'barbers';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'service_barbers_service_id_fkey';
            columns: ['service_id'];
            isOneToOne: false;
            referencedRelation: 'services';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'service_barbers_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      services: {
        Row: {
          category: string | null;
          created_at: string;
          description: string | null;
          duration_min: number;
          icon: string;
          id: string;
          is_active: boolean;
          name: string;
          price_cents: number;
          requires_deposit: boolean;
          sort_order: number;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          category?: string | null;
          created_at?: string;
          description?: string | null;
          duration_min: number;
          icon?: string;
          id?: string;
          is_active?: boolean;
          name: string;
          price_cents: number;
          requires_deposit?: boolean;
          sort_order?: number;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          category?: string | null;
          created_at?: string;
          description?: string | null;
          duration_min?: number;
          icon?: string;
          id?: string;
          is_active?: boolean;
          name?: string;
          price_cents?: number;
          requires_deposit?: boolean;
          sort_order?: number;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'services_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      staff: {
        Row: {
          barber_grade: Database['public']['Enums']['barber_grade'] | null;
          category: string | null;
          commission_bp: number;
          created_at: string;
          email: string | null;
          id: string;
          initials: string;
          is_active: boolean;
          name: string;
          phone: string | null;
          photo_url: string | null;
          roles: Database['public']['Enums']['staff_role'][];
          shift: string | null;
          sort_order: number;
          tenant_id: string;
          tone: string;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          barber_grade?: Database['public']['Enums']['barber_grade'] | null;
          category?: string | null;
          commission_bp?: number;
          created_at?: string;
          email?: string | null;
          id?: string;
          initials: string;
          is_active?: boolean;
          name: string;
          phone?: string | null;
          photo_url?: string | null;
          roles?: Database['public']['Enums']['staff_role'][];
          shift?: string | null;
          sort_order?: number;
          tenant_id: string;
          tone?: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          barber_grade?: Database['public']['Enums']['barber_grade'] | null;
          category?: string | null;
          commission_bp?: number;
          created_at?: string;
          email?: string | null;
          id?: string;
          initials?: string;
          is_active?: boolean;
          name?: string;
          phone?: string | null;
          photo_url?: string | null;
          roles?: Database['public']['Enums']['staff_role'][];
          shift?: string | null;
          sort_order?: number;
          tenant_id?: string;
          tone?: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'staff_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      stripe_events: {
        Row: {
          api_version: string | null;
          error: string | null;
          event_id: string;
          livemode: boolean;
          payload: Json;
          processed_at: string | null;
          received_at: string;
          tenant_id: string | null;
          type: string;
        };
        Insert: {
          api_version?: string | null;
          error?: string | null;
          event_id: string;
          livemode?: boolean;
          payload: Json;
          processed_at?: string | null;
          received_at?: string;
          tenant_id?: string | null;
          type: string;
        };
        Update: {
          api_version?: string | null;
          error?: string | null;
          event_id?: string;
          livemode?: boolean;
          payload?: Json;
          processed_at?: string | null;
          received_at?: string;
          tenant_id?: string | null;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'stripe_events_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      super_admins: {
        Row: {
          created_at: string;
          display_name: string | null;
          email: string;
          id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          display_name?: string | null;
          email: string;
          id?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          display_name?: string | null;
          email?: string;
          id?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      tenant_branding: {
        Row: {
          brand_deep: string;
          brand_glow: string;
          brand_primary: string;
          created_at: string;
          custom_domain: string | null;
          custom_domain_verified_at: string | null;
          favicon_url: string | null;
          font_display: string | null;
          footer_signature_enabled: boolean;
          id: string;
          logo_url: string | null;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          brand_deep?: string;
          brand_glow?: string;
          brand_primary?: string;
          created_at?: string;
          custom_domain?: string | null;
          custom_domain_verified_at?: string | null;
          favicon_url?: string | null;
          font_display?: string | null;
          footer_signature_enabled?: boolean;
          id?: string;
          logo_url?: string | null;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          brand_deep?: string;
          brand_glow?: string;
          brand_primary?: string;
          created_at?: string;
          custom_domain?: string | null;
          custom_domain_verified_at?: string | null;
          favicon_url?: string | null;
          font_display?: string | null;
          footer_signature_enabled?: boolean;
          id?: string;
          logo_url?: string | null;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tenant_branding_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: true;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      tenant_gallery: {
        Row: {
          caption: string | null;
          created_at: string;
          id: string;
          photo_url: string;
          sort_order: number;
          tenant_id: string;
        };
        Insert: {
          caption?: string | null;
          created_at?: string;
          id?: string;
          photo_url: string;
          sort_order?: number;
          tenant_id: string;
        };
        Update: {
          caption?: string | null;
          created_at?: string;
          id?: string;
          photo_url?: string;
          sort_order?: number;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tenant_gallery_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      tenant_role_domains: {
        Row: {
          created_at: string;
          hostname: string;
          id: string;
          role_path: string;
          tenant_id: string;
          updated_at: string;
          verified_at: string | null;
        };
        Insert: {
          created_at?: string;
          hostname: string;
          id?: string;
          role_path?: string;
          tenant_id: string;
          updated_at?: string;
          verified_at?: string | null;
        };
        Update: {
          created_at?: string;
          hostname?: string;
          id?: string;
          role_path?: string;
          tenant_id?: string;
          updated_at?: string;
          verified_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'tenant_role_domains_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      tenant_settings: {
        Row: {
          address_city: string | null;
          address_street: string | null;
          address_zip: string | null;
          branch: string | null;
          business_hours: Json;
          cancellation_policy: Json;
          cashback_rate_bp: number;
          cleanup_minutes: number;
          contact_email: string | null;
          contact_instagram: string | null;
          contact_phone: string | null;
          contact_website: string | null;
          created_at: string;
          deposit_policy: Json;
          email_from_address: string | null;
          holidays: Json;
          hours_text: string | null;
          id: string;
          legal_address: string | null;
          legal_name: string | null;
          legal_siret: string | null;
          legal_tva_number: string | null;
          loyalty_enabled: boolean;
          loyalty_ratio: number;
          loyalty_redeem_threshold: number;
          maps_url: string | null;
          reminder_email_hours: number;
          reminder_sms_hours: number;
          sms_enabled: boolean;
          tagline: string | null;
          tax_rate_bp: number;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          address_city?: string | null;
          address_street?: string | null;
          address_zip?: string | null;
          branch?: string | null;
          business_hours?: Json;
          cancellation_policy?: Json;
          cashback_rate_bp?: number;
          cleanup_minutes?: number;
          contact_email?: string | null;
          contact_instagram?: string | null;
          contact_phone?: string | null;
          contact_website?: string | null;
          created_at?: string;
          deposit_policy?: Json;
          email_from_address?: string | null;
          holidays?: Json;
          hours_text?: string | null;
          id?: string;
          legal_address?: string | null;
          legal_name?: string | null;
          legal_siret?: string | null;
          legal_tva_number?: string | null;
          loyalty_enabled?: boolean;
          loyalty_ratio?: number;
          loyalty_redeem_threshold?: number;
          maps_url?: string | null;
          reminder_email_hours?: number;
          reminder_sms_hours?: number;
          sms_enabled?: boolean;
          tagline?: string | null;
          tax_rate_bp?: number;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          address_city?: string | null;
          address_street?: string | null;
          address_zip?: string | null;
          branch?: string | null;
          business_hours?: Json;
          cancellation_policy?: Json;
          cashback_rate_bp?: number;
          cleanup_minutes?: number;
          contact_email?: string | null;
          contact_instagram?: string | null;
          contact_phone?: string | null;
          contact_website?: string | null;
          created_at?: string;
          deposit_policy?: Json;
          email_from_address?: string | null;
          holidays?: Json;
          hours_text?: string | null;
          id?: string;
          legal_address?: string | null;
          legal_name?: string | null;
          legal_siret?: string | null;
          legal_tva_number?: string | null;
          loyalty_enabled?: boolean;
          loyalty_ratio?: number;
          loyalty_redeem_threshold?: number;
          maps_url?: string | null;
          reminder_email_hours?: number;
          reminder_sms_hours?: number;
          sms_enabled?: boolean;
          tagline?: string | null;
          tax_rate_bp?: number;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'tenant_settings_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: true;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
      tenants: {
        Row: {
          created_at: string;
          currency: string;
          id: string;
          locale: string;
          name: string;
          plan: Database['public']['Enums']['tenant_plan'];
          slug: string;
          status: Database['public']['Enums']['tenant_status'];
          stripe_connect_account_id: string | null;
          stripe_connect_status: string | null;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          timezone: string;
          trial_ends_at: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          currency?: string;
          id?: string;
          locale?: string;
          name: string;
          plan?: Database['public']['Enums']['tenant_plan'];
          slug: string;
          status?: Database['public']['Enums']['tenant_status'];
          stripe_connect_account_id?: string | null;
          stripe_connect_status?: string | null;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          timezone?: string;
          trial_ends_at?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          currency?: string;
          id?: string;
          locale?: string;
          name?: string;
          plan?: Database['public']['Enums']['tenant_plan'];
          slug?: string;
          status?: Database['public']['Enums']['tenant_status'];
          stripe_connect_account_id?: string | null;
          stripe_connect_status?: string | null;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          timezone?: string;
          trial_ends_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      usage_metrics: {
        Row: {
          active_barbers: number;
          bookings_count: number;
          created_at: string;
          emails_sent: number;
          id: string;
          metric_date: string;
          revenue_cents: number;
          sales_count: number;
          sms_sent: number;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          active_barbers?: number;
          bookings_count?: number;
          created_at?: string;
          emails_sent?: number;
          id?: string;
          metric_date: string;
          revenue_cents?: number;
          sales_count?: number;
          sms_sent?: number;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          active_barbers?: number;
          bookings_count?: number;
          created_at?: string;
          emails_sent?: number;
          id?: string;
          metric_date?: string;
          revenue_cents?: number;
          sales_count?: number;
          sms_sent?: number;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'usage_metrics_tenant_id_fkey';
            columns: ['tenant_id'];
            isOneToOne: false;
            referencedRelation: 'tenants';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      current_tenant_id: { Args: never; Returns: string };
      custom_access_token_hook: { Args: { event: Json }; Returns: Json };
      is_super_admin: { Args: never; Returns: boolean };
      lookup_tenant_branding: {
        Args: { p_domain?: string; p_slug?: string };
        Returns: {
          brand_deep: string;
          brand_glow: string;
          brand_primary: string;
          custom_domain: string;
          footer_signature_enabled: boolean;
          name: string;
          role_domains: Json;
          role_path: string;
          slug: string;
          tenant_id: string;
        }[];
      };
    };
    Enums: {
      barber_grade: 'Apprenti' | 'Barbier' | 'Senior' | 'Maître barbier';
      barber_role: 'apprentice' | 'barber' | 'senior' | 'master';
      booking_source: 'client_app' | 'cashier' | 'walk_in' | 'manager' | 'waitlist' | 'widget';
      booking_status: 'upcoming' | 'in_chair' | 'done' | 'cancelled' | 'no_show';
      client_link_status: 'active' | 'banned' | 'opted_out';
      gift_card_status: 'active' | 'redeemed' | 'expired' | 'voided';
      loyalty_event_kind: 'earned' | 'redeemed' | 'adjusted' | 'expired';
      product_movement_kind: 'sale' | 'restock' | 'adjustment' | 'loss' | 'return';
      sale_item_kind: 'service' | 'product' | 'discount' | 'gift_card_redeem';
      sale_method: 'card' | 'cash' | 'mobile' | 'gift_card' | 'split' | 'comp';
      sale_status: 'pending' | 'completed' | 'refunded' | 'voided';
      staff_role: 'barber' | 'cashier';
      tenant_plan: 'starter' | 'pro' | 'business';
      tenant_status: 'trial' | 'active' | 'past_due' | 'canceled' | 'suspended';
      time_off_kind: 'vacation' | 'sick' | 'training' | 'unpaid' | 'other';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema['Tables']
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema['Enums']
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      barber_grade: ['Apprenti', 'Barbier', 'Senior', 'Maître barbier'],
      barber_role: ['apprentice', 'barber', 'senior', 'master'],
      booking_source: ['client_app', 'cashier', 'walk_in', 'manager', 'waitlist', 'widget'],
      booking_status: ['upcoming', 'in_chair', 'done', 'cancelled', 'no_show'],
      client_link_status: ['active', 'banned', 'opted_out'],
      gift_card_status: ['active', 'redeemed', 'expired', 'voided'],
      loyalty_event_kind: ['earned', 'redeemed', 'adjusted', 'expired'],
      product_movement_kind: ['sale', 'restock', 'adjustment', 'loss', 'return'],
      sale_item_kind: ['service', 'product', 'discount', 'gift_card_redeem'],
      sale_method: ['card', 'cash', 'mobile', 'gift_card', 'split', 'comp'],
      sale_status: ['pending', 'completed', 'refunded', 'voided'],
      staff_role: ['barber', 'cashier'],
      tenant_plan: ['starter', 'pro', 'business'],
      tenant_status: ['trial', 'active', 'past_due', 'canceled', 'suspended'],
      time_off_kind: ['vacation', 'sick', 'training', 'unpaid', 'other'],
    },
  },
} as const;
