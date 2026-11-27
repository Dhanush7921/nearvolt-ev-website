package com.nearvolt.ev.data.api

import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query

interface ApiService {
    @GET("api/v1/public/config") suspend fun config(): Response<Envelope<PublicConfig>>

    @GET("api/v1/me") suspend fun me(): Response<Envelope<Me>>
    @PUT("api/v1/me/consents") suspend fun consents(@Body b: Consents): Response<Envelope<Ack>>
    @PUT("api/v1/me/profile") suspend fun profile(@Body b: ProfileBody): Response<Envelope<Me>>
    @POST("api/v1/me/role") suspend fun role(@Body b: RoleBody): Response<Envelope<Ack>>
    @POST("api/v1/me/session") suspend fun session(@Body b: SessionBody): Response<Envelope<Ack>>
    @POST("api/v1/me/devices") suspend fun registerDevice(@Body b: DeviceBody): Response<Envelope<Ack>>
    @DELETE("api/v1/me/devices/{token}") suspend fun removeDevice(@Path("token") token: String): Response<Envelope<Ack>>
    @GET("api/v1/me/notifications") suspend fun notifications(@Query("cursor") cursor: String? = null): Response<Envelope<Page<AppNotification>>>
    @POST("api/v1/me/notifications/read-all") suspend fun readAll(): Response<Envelope<Ack>>
    @DELETE("api/v1/me") suspend fun deleteAccount(): Response<Envelope<Ack>>

    @POST("api/v1/auth/otp/send") suspend fun otpSend(@Body b: OtpSendBody): Response<Envelope<OtpSent>>
    @POST("api/v1/auth/otp/verify") suspend fun otpVerify(@Body b: OtpVerifyBody): Response<Envelope<OtpVerified>>

    @GET("api/v1/hosts/nearby") suspend fun nearby(
        @Query("lat") lat: Double, @Query("lng") lng: Double, @Query("radiusKm") radiusKm: Double,
        @Query("connector") connector: String?, @Query("vehicleType") vehicleType: String?, @Query("exclude") exclude: String?,
    ): Response<Envelope<NearbyResponse>>
    @GET("api/v1/hosts/me") suspend fun myListing(): Response<Envelope<HostListing>>
    @PUT("api/v1/hosts/me") suspend fun saveListing(@Body b: HostProfileBody): Response<Envelope<HostListing>>
    @POST("api/v1/hosts/me/submit") suspend fun submitListing(): Response<Envelope<Ack>>
    @PUT("api/v1/hosts/me/availability") suspend fun availability(@Body b: AvailabilityBody): Response<Envelope<Ack>>
    @POST("api/v1/hosts/me/uploads") suspend fun uploadTicket(@Body b: UploadBody): Response<Envelope<UploadTicket>>
    @POST("api/v1/hosts/me/uploads/confirm") suspend fun confirmUpload(@Body b: PathBody): Response<Envelope<Ack>>

    @POST("api/v1/requests") suspend fun createRequest(@Header("Idempotency-Key") key: String, @Body b: CreateRequestBody): Response<Envelope<ChargeRequest>>
    @GET("api/v1/requests") suspend fun requests(@Query("as") asRole: String, @Query("status") status: String?, @Query("cursor") cursor: String?): Response<Envelope<Page<ChargeRequest>>>
    @GET("api/v1/requests/{id}") suspend fun request(@Path("id") id: String): Response<Envelope<ChargeRequest>>
    @POST("api/v1/requests/{id}/transition") suspend fun transition(@Path("id") id: String, @Body b: TransitionBody): Response<Envelope<ChargeRequest>>
    @POST("api/v1/requests/{id}/pin") suspend fun reissuePin(@Path("id") id: String): Response<Envelope<ChargeRequest>>
    @POST("api/v1/requests/{id}/feedback") suspend fun feedback(@Path("id") id: String, @Body b: FeedbackBody): Response<Envelope<Ack>>

    @POST("api/v1/support/tickets") suspend fun createTicket(@Body b: TicketBody): Response<Envelope<TicketCreated>>
    @GET("api/v1/support/tickets") suspend fun tickets(): Response<Envelope<Page<Ticket>>>
}
