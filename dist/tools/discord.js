import { z } from 'zod';
import { DiscordRestProxy } from '@promethean-os/discord';
const RestResponseSchema = z
    .object({
    ok: z.boolean(),
    status: z.number(),
    body: z.unknown().optional(),
    bucket: z.string().optional(),
    retry_after_ms: z.number().optional(),
})
    .readonly();
const defaultProxyFactory = () => new DiscordRestProxy();
const resolveProvider = (explicit, env) => explicit ?? env.DISCORD_PROVIDER ?? 'discord';
const requireValue = (value, message) => z.string({ required_error: message }).min(1, message).parse(value);
const resolveTenant = (explicit, env) => {
    const tenant = explicit ?? env.DISCORD_TENANT ?? env.DISCORD_GUILD ?? env.DISCORD_SPACE_TENANT;
    return requireValue(tenant, 'discord tools require a tenant; pass `tenant` or set DISCORD_TENANT / DISCORD_GUILD');
};
const resolveSpaceUrn = (explicit, env) => {
    const urn = explicit ?? env.DISCORD_SPACE_URN ?? env.DISCORD_CHANNEL_URN;
    return requireValue(urn, 'discord tools require a spaceUrn; pass `spaceUrn` or set DISCORD_SPACE_URN');
};
const mapResult = (input) => {
    const safe = RestResponseSchema.parse(input);
    return {
        ok: safe.ok,
        status: safe.status,
        ...(typeof safe.body !== 'undefined' ? { body: safe.body } : {}),
        ...(safe.bucket ? { bucket: safe.bucket } : {}),
        retryAfterMs: typeof safe.retry_after_ms === 'number' ? safe.retry_after_ms : null,
    };
};
const MessagePayload = z
    .object({
    content: z.string().max(2000).optional(),
    embeds: z.array(z.unknown()).optional(),
    allowed_mentions: z.unknown().optional(),
    tts: z.boolean().optional(),
    components: z.array(z.unknown()).optional(),
    attachments: z.array(z.unknown()).optional(),
})
    .refine((value) => Boolean(value.content) || Boolean(value.embeds?.length), 'message content or embeds are required');
const createSendMessageTool = (ctx, proxyFactory) => {
    const shape = {
        provider: z.string().optional(),
        tenant: z.string().optional(),
        spaceUrn: z.string().optional(),
        message: MessagePayload,
    };
    const Schema = z.object(shape);
    const spec = {
        name: 'discord_send_message',
        description: 'Send a message to a Discord channel. Provide content or embeds and the Discord space URN.',
        inputSchema: Schema.shape,
        stability: 'experimental',
        since: '0.1.0',
    };
    const proxy = proxyFactory();
    const invoke = async (raw) => {
        const args = Schema.parse(raw);
        const provider = resolveProvider(args.provider, ctx.env);
        const tenant = resolveTenant(args.tenant, ctx.env);
        const spaceUrn = resolveSpaceUrn(args.spaceUrn, ctx.env);
        const { method, route } = proxy.routeForPostMessage(spaceUrn);
        const res = await proxy.send(provider, tenant, method, route, args.message, ctx.fetch);
        return mapResult(res);
    };
    return { spec, invoke };
};
const ListSchemaShape = {
    provider: z.string().optional(),
    tenant: z.string().optional(),
    spaceUrn: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional(),
    before: z.string().optional(),
    after: z.string().optional(),
    around: z.string().optional(),
};
const ListSchema = z.object(ListSchemaShape);
const createListMessagesTool = (ctx, proxyFactory) => {
    const spec = {
        name: 'discord_list_messages',
        description: 'List recent messages from a Discord channel with optional pagination parameters.',
        inputSchema: ListSchemaShape,
        stability: 'experimental',
        since: '0.1.0',
    };
    const proxy = proxyFactory();
    const invoke = async (raw) => {
        const args = ListSchema.parse(raw);
        const provider = resolveProvider(args.provider, ctx.env);
        const tenant = resolveTenant(args.tenant, ctx.env);
        const spaceUrn = resolveSpaceUrn(args.spaceUrn, ctx.env);
        const params = {
            ...(typeof args.limit === 'number' ? { limit: args.limit } : {}),
            ...(args.before ? { before: args.before } : {}),
            ...(args.after ? { after: args.after } : {}),
            ...(args.around ? { around: args.around } : {}),
        };
        const { method, route } = proxy.routeForListMessages(spaceUrn, params);
        const res = await proxy.send(provider, tenant, method, route, undefined, ctx.fetch);
        return mapResult(res);
    };
    return { spec, invoke };
};
export const createDiscordSendMessageTool = (proxyFactory = defaultProxyFactory) => {
    return (ctx) => createSendMessageTool(ctx, proxyFactory);
};
export const createDiscordListMessagesTool = (proxyFactory = defaultProxyFactory) => {
    return (ctx) => createListMessagesTool(ctx, proxyFactory);
};
export const discordSendMessage = createDiscordSendMessageTool();
export const discordListMessages = createDiscordListMessagesTool();
export const discordTools = (ctx, proxyFactory = defaultProxyFactory) => ({
    sendMessage: createSendMessageTool(ctx, proxyFactory),
    listMessages: createListMessagesTool(ctx, proxyFactory),
});
// Export schemas for testing
export { MessagePayload, ListSchema };
//# sourceMappingURL=discord.js.map