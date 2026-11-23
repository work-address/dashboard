import express from 'express'
import {
  Authorized,
  Body,
  Delete,
  Get,
  HttpCode,
  JsonController,
  OnUndefined,
  Param,
  Post,
  Req,
  Res,
} from 'routing-controllers'

import { App } from '@/app/app'
import { CurrentUser } from '@/decorator/current-user'
import { OpenAPIExtended } from '@/decorator/openapi/openapi-extended'
import { User } from '@/entity/user'
import { SharedReportCreateDto } from '@/model/dto/shared-report'
import { EUserRole } from '@/model/user'
import { SharedReportLimit } from '@/service/shared-report-limit'
import { SharedReportManager } from '@/service/shared-report-manager'

const strict = { validate: { whitelist: true, forbidNonWhitelisted: true } }
/**
 * Said outright for the routes at the controller's own path: the spec marks
 * `@Authorized` routes by their path, and those two have none of their own.
 */
const bearer = { security: [{ bearerAuth: [] }] }

/** Shared reports: the sharer's own, and the link anyone opens. */
@JsonController('/report')
export class ReportController {
  private reports = App.container.get<SharedReportManager>(
    'SharedReportManager',
  )
  private limit = App.container.get<SharedReportLimit>('SharedReportLimit')

  @Authorized([EUserRole.ROLE_USER])
  @Post()
  @HttpCode(200)
  @OpenAPIExtended({
    summary:
      'Share a span of what the caller sees in statistics, at a link anyone can open',
    operation: bearer,
    body: { schema: SharedReportCreateDto },
  })
  create(@CurrentUser() user: User, @Body(strict) data: SharedReportCreateDto) {
    return this.reports.create(data, user)
  }

  @Authorized([EUserRole.ROLE_USER])
  @Get()
  @OpenAPIExtended({
    summary: "The caller's own shared reports, newest first",
    operation: bearer,
  })
  list(@CurrentUser() user: User) {
    return this.reports.list(user)
  }

  /**
   * Open to anyone with the link. No session is read, so a stale or foreign
   * one in the request changes nothing and is never answered with 401.
   */
  @Get('/public/:token')
  @OpenAPIExtended({
    summary:
      "A shared report by its link's secret, read now in the sharer's scope: time by day, project, person and agent, and amounts only if the sharer switched them on. 404 for a link that is unknown or deleted, 410 while a plan hides part of its span",
    operation: { security: [] },
  })
  open(
    @Param('token') token: string,
    @Req() request: express.Request,
    @Res() response: express.Response,
  ) {
    try {
      this.limit.take(request.ip)
    } catch (error) {
      response.setHeader('Retry-After', this.limit.retryAfterSeconds())
      throw error
    }

    return this.reports.readPublic(token)
  }

  @Authorized([EUserRole.ROLE_USER])
  @Delete('/:id')
  @HttpCode(204)
  @OnUndefined(204)
  @OpenAPIExtended({
    summary: "Delete one of the caller's shared reports, which ends its link",
  })
  remove(@CurrentUser() user: User, @Param('id') id: string) {
    return this.reports.remove(id, user)
  }

  @Authorized([EUserRole.ROLE_USER])
  @Post('/:id/invoice')
  @HttpCode(200)
  @OpenAPIExtended({
    summary:
      "Invoice the period of a report of the caller's own time on one project; answers the invoice's id, the same one however often it is asked",
  })
  invoice(@CurrentUser() user: User, @Param('id') id: string) {
    return this.reports.invoice(id, user)
  }
}
