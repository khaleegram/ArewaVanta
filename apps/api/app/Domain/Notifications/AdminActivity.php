<?php

namespace App\Domain\Notifications;

use App\Enums\Role;
use App\Enums\RoleScope;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Minishlink\WebPush\Subscription;
use Minishlink\WebPush\WebPush;

final class AdminActivity
{
    public function record(User $actor, string $message): void
    {
        $message = Str::limit($message, 255, '');
        $admins = User::query()->whereHas('roleAssignments', fn ($query) => $query->where('role', Role::PlatformAdmin->value)->where('scope_type', RoleScope::Global->value)->where('scope_id', '*'))->whereKeyNot($actor->id)->pluck('id');
        foreach ($admins as $id) {
            DB::table('admin_activity')->insert(['user_id' => $id, 'message' => $message, 'created_at' => now(), 'updated_at' => now()]);
        }
        if ($admins->isNotEmpty()) {
            DB::afterCommit(fn () => $this->push($admins->all(), $message));
        }
    }

    private function push(array $admins, string $message): void
    {
        $public = config('services.web_push.public_key');
        $private = config('services.web_push.private_key');
        $subject = config('services.web_push.subject');
        if (! $public || ! $private || ! $subject) {
            return;
        }
        try {
            $push = new WebPush(['VAPID' => ['subject' => $subject, 'publicKey' => $public, 'privateKey' => $private]], ['TTL' => 3600]);
            foreach (DB::table('admin_push_subscriptions')->whereIn('user_id', $admins)->get() as $item) {
                try {
                    $subscription = Subscription::create(['endpoint' => $item->endpoint, 'keys' => ['p256dh' => $item->public_key, 'auth' => $item->auth_token], 'contentEncoding' => 'aes128gcm']);
                    $result = $push->sendOneNotification($subscription, json_encode(['title' => 'ArewaVanta', 'body' => $message], JSON_THROW_ON_ERROR));
                    if ($result->isSubscriptionExpired()) {
                        DB::table('admin_push_subscriptions')->where('id', $item->id)->delete();
                    }
                } catch (\Throwable $error) {
                    report($error);
                }
            }
        } catch (\Throwable $error) {
            report($error);
        }
    }
}
